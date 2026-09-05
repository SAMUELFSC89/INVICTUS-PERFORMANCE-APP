#!/usr/bin/env python3
"""Build verified, lossless WebP derivatives without altering the source images.

ImageMagick performs format conversion only. Pillow is used only to inspect
metadata and decode RGBA bytes for comparison; it never saves or resizes images.
This script does not assess exercise technique or change catalogue ready states.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image


REPOSITORY = Path(__file__).resolve().parent.parent
VERSION = "rebuild-2026-09-05"
EXPORT = REPOSITORY / "design" / "exercise-library" / VERSION / "exercise-catalog.json"
PUBLIC_DIRECTORY = REPOSITORY / "public" / "assets" / "exercise-library" / VERSION
LEGACY_SEEDS = frozenset({
    "dumbbell_bench_press", "incline_dumbbell_press", "pec_deck_fly",
    "classic_push_up", "decline_push_up", "incline_push_up",
    "barbell_bent_over_row", "t_bar_row", "leg_curl", "seated_leg_curl",
    "barbell_stiff_deadlift", "dumbbell_lunge", "dumbbell_walking_lunge",
})


def sha256(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def inspect(contents: bytes, expected_format: str) -> tuple[dict, bytes]:
    """Decode bytes for read-only validation, including pixels hidden by alpha."""
    if not contents:
        raise ValueError("Image file is empty")
    with Image.open(io.BytesIO(contents)) as image:
        if image.format != expected_format:
            raise ValueError(f"Expected {expected_format}, found {image.format}")
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError("Only a single static frame is allowed")
        image.load()
        if image.width < 1 or image.height < 1:
            raise ValueError("Invalid image dimensions")
        rgba = image.convert("RGBA")  # Inspection only; never saved by Pillow.
        pixels = rgba.tobytes()
        alpha_extrema = rgba.getchannel("A").getextrema()
        metadata = {
            "format": image.format,
            "mode": image.mode,
            "width": image.width,
            "height": image.height,
            "bytes": len(contents),
            "sha256": sha256(contents),
            "rgbaSha256": sha256(pixels),
            "alphaExtrema": list(alpha_extrema),
            "containsTransparency": alpha_extrema[0] < 255,
        }
    return metadata, pixels


def compare(source: dict, source_pixels: bytes, candidate: dict, candidate_pixels: bytes) -> dict:
    dimensions_equal = (source["width"], source["height"]) == (candidate["width"], candidate["height"])
    pixels_equal = dimensions_equal and source_pixels == candidate_pixels
    result = {"dimensionsMatch": dimensions_equal, "rgbaMatch": pixels_equal}
    if pixels_equal:
        return {**result, "differentPixels": 0, "differentRgbPixels": 0, "differentAlphaPixels": 0}
    if not dimensions_equal:
        return {**result, "differentPixels": None, "differentRgbPixels": None, "differentAlphaPixels": None}
    different_pixels = different_rgb = different_alpha = 0
    for offset in range(0, len(source_pixels), 4):
        before = source_pixels[offset:offset + 4]
        after = candidate_pixels[offset:offset + 4]
        different_pixels += before != after
        different_rgb += before[:3] != after[:3]
        different_alpha += before[3] != after[3]
    return {**result, "differentPixels": different_pixels, "differentRgbPixels": different_rgb, "differentAlphaPixels": different_alpha}


def atomic_json(destination: Path, value: dict) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".media-report-", suffix=".json", dir=destination.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def choose_source(exercise_id: str, source_directory: Path) -> tuple[Path | None, str]:
    generated = source_directory / f"{exercise_id}.png"
    if generated.exists():
        return generated, "generated_source_directory"
    if exercise_id in LEGACY_SEEDS:
        original = REPOSITORY / "public" / "assets" / "exercise-library" / "v1" / exercise_id / "thumb.png"
        if original.exists():
            return original, "allowed_legacy_original"
    return None, "generated_source_required" if exercise_id not in LEGACY_SEEDS else "allowed_source_missing"


def build_one(exercise_id: str, source: Path, source_kind: str, converter: str) -> dict:
    output = PUBLIC_DIRECTORY / exercise_id / "thumb.webp"
    record = {
        "id": exercise_id,
        "sourcePath": str(source.resolve()),
        "sourceKind": source_kind,
        "webpPath": str(output.relative_to(REPOSITORY)),
        "webpUrl": f"/assets/exercise-library/{VERSION}/{exercise_id}/thumb.webp",
        "contentReview": "not_assessed_by_this_format_converter",
    }
    try:
        source_contents = source.read_bytes()
        source_metadata, source_pixels = inspect(source_contents, "PNG")
        record["source"] = source_metadata
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            try:
                current_metadata, current_pixels = inspect(output.read_bytes(), "WEBP")
                current_comparison = compare(source_metadata, source_pixels, current_metadata, current_pixels)
            except (OSError, ValueError, SyntaxError):
                current_comparison = {"dimensionsMatch": False, "rgbaMatch": False}
            if current_comparison["rgbaMatch"]:
                # Re-read both files to detect replacement/truncation during inspection.
                if sha256(source.read_bytes()) != source_metadata["sha256"]:
                    raise ValueError("Source changed during validation; retry after source generation completes")
                if sha256(output.read_bytes()) != current_metadata["sha256"]:
                    raise ValueError("Output changed during validation; retry after other writers finish")
                return {
                    **record, "status": "verified", "action": "reused", "webp": current_metadata,
                    "verification": {**current_comparison, "publishedHashMatches": True, "sourceHashUnchanged": True},
                    "savingsBytes": source_metadata["bytes"] - current_metadata["bytes"],
                }

        # The temporary directory and final output share a filesystem. Atomic replace
        # occurs only after the completed candidate is decoded and compared to source.
        # Keep intermediates outside public: a parallel app build must never
        # collect candidate images or frozen source copies as production assets.
        with tempfile.TemporaryDirectory(prefix="invictus-webp-build-", dir=REPOSITORY.parent) as temporary_directory:
            temporary_root = Path(temporary_directory)
            frozen_source = temporary_root / "source.png"
            candidate = temporary_root / "candidate.webp"
            # Freeze the inspected bytes: ongoing image generation cannot alter this input.
            with frozen_source.open("wb") as stream:
                stream.write(source_contents)
                stream.flush()
                os.fsync(stream.fileno())
            command = [
                converter, str(frozen_source),
                "-define", "webp:lossless=true",
                "-define", "webp:exact=true",
                "-define", "webp:method=6",
                str(candidate),
            ]
            subprocess.run(command, check=True, capture_output=True, text=True)
            candidate_metadata, candidate_pixels = inspect(candidate.read_bytes(), "WEBP")
            verification = compare(source_metadata, source_pixels, candidate_metadata, candidate_pixels)
            if not verification["rgbaMatch"]:
                record["verification"] = verification
                raise ValueError("Lossless verification failed; existing published file was preserved")
            if sha256(source.read_bytes()) != source_metadata["sha256"]:
                raise ValueError("Source changed during conversion; existing published file was preserved")
            with candidate.open("rb") as stream:
                os.fsync(stream.fileno())
            os.replace(candidate, output)
            # Validate the actual final path, not merely the pre-publication candidate.
            published_metadata, published_pixels = inspect(output.read_bytes(), "WEBP")
            published_comparison = compare(source_metadata, source_pixels, published_metadata, published_pixels)
            if published_metadata["sha256"] != candidate_metadata["sha256"] or not published_comparison["rgbaMatch"]:
                raise ValueError("Published file failed verification; do not mark this asset ready")
            return {
                **record, "status": "verified", "action": "converted", "webp": published_metadata,
                "verification": {**published_comparison, "publishedHashMatches": True, "sourceHashUnchanged": True},
                "savingsBytes": source_metadata["bytes"] - published_metadata["bytes"],
            }
    except (OSError, ValueError, SyntaxError, subprocess.CalledProcessError) as error:
        message = str(error)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            message += ": " + error.stderr.strip()[:1200]
        return {**record, "status": "failed", "error": message}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=REPOSITORY.parent / "rebuild-exercises" / "source-images")
    parser.add_argument("--report", type=Path, default=REPOSITORY / "design" / "exercise-library" / VERSION / "media-build.json")
    parser.add_argument("--require-complete", action="store_true", help="Exit unsuccessfully unless all 59 assets are verified in this run")
    parser.add_argument("--ids", nargs="+", help="Process only these IDs for a bounded sample; report still lists all 59")
    args = parser.parse_args()
    source_directory = args.source_dir.resolve()
    catalog = json.loads(EXPORT.read_text(encoding="utf-8"))
    exercise_ids = [exercise["id"] for exercise in catalog["exercises"]]
    if len(exercise_ids) != 59 or len(set(exercise_ids)) != 59:
        parser.error("Export must contain exactly 59 unique exercise IDs")
    if any(not re.fullmatch(r"[a-z][a-z0-9_]*", exercise_id) for exercise_id in exercise_ids):
        parser.error("Invalid exercise ID in export")
    if not LEGACY_SEEDS.issubset(exercise_ids):
        parser.error("The export is missing a permitted legacy ID")
    selected = set(args.ids) if args.ids is not None else set(exercise_ids)
    unknown = selected.difference(exercise_ids)
    if unknown:
        parser.error("Unknown IDs: " + ", ".join(sorted(unknown)))
    converter = shutil.which("convert")
    if not converter:
        parser.error("ImageMagick convert was not found; no image files were changed")
    converter_version = subprocess.run([converter, "-version"], check=True, capture_output=True, text=True).stdout.splitlines()[0]
    records = []
    for exercise_id in exercise_ids:
        if exercise_id not in selected:
            records.append({"id": exercise_id, "status": "not_selected"})
            continue
        source, source_kind = choose_source(exercise_id, source_directory)
        if source is None:
            record = {
                "id": exercise_id, "status": "missing_source", "sourceKind": source_kind,
                "expectedGeneratedSource": str(source_directory / f"{exercise_id}.png"),
            }
        else:
            record = build_one(exercise_id, source, source_kind, converter)
        records.append(record)
        print(f"{exercise_id}: {record['status']}" + (f" ({record['action']})" if "action" in record else ""), flush=True)
    verified = [record for record in records if record["status"] == "verified"]
    source_bytes = sum(record["source"]["bytes"] for record in verified)
    derivative_bytes = sum(record["webp"]["bytes"] for record in verified)
    counts = {status: sum(record["status"] == status for record in records) for status in ["verified", "missing_source", "failed", "not_selected"]}
    report = {
        "schemaVersion": 1,
        "version": VERSION,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceCatalog": str(EXPORT.relative_to(REPOSITORY)),
        "sourceCatalogSha256": sha256(EXPORT.read_bytes()),
        "sourceDirectory": str(source_directory),
        "converter": converter_version,
        "conversionOptions": ["webp:lossless=true", "webp:exact=true", "webp:method=6"],
        "operations": "format_conversion_only; no cropping, background removal, resizing or pixel editing",
        "pillowUsage": "read_only_metadata_and_rgba_comparison",
        "catalogStatesChanged": False,
        "contentReview": "not_assessed_by_this_format_converter",
        "legacySeedAllowlist": sorted(LEGACY_SEEDS),
        "totalCatalogEntries": len(exercise_ids),
        "complete": len(verified) == 59,
        "counts": counts,
        "totalsForVerifiedAssets": {
            "sourceBytes": source_bytes,
            "webpBytes": derivative_bytes,
            "savingsBytes": source_bytes - derivative_bytes,
            "savingsPercent": round((source_bytes - derivative_bytes) * 100 / source_bytes, 4) if source_bytes else None,
            "bytesIfSourcesAndDerivativesBothBundled": source_bytes + derivative_bytes,
            "note": "Asset-byte totals only. Keeping original PNGs plus WebP increases bundled bytes; this is not an APK-size reduction measurement.",
        },
        "assets": records,
    }
    atomic_json(args.report.resolve(), report)
    print(f"Report: {args.report.resolve()} | verified {len(verified)}/59 | failed {counts['failed']} | missing {counts['missing_source']}", flush=True)
    return 1 if counts["failed"] or (args.require_complete and len(verified) != 59) else 0


if __name__ == "__main__":
    sys.exit(main())
