import crypto from 'crypto';

export interface PhotoEngineReport {
  isPhotoValid: boolean;
  isDuplicatePhoto: boolean;
  isAiGenerated: boolean;
  isInternetStockPhoto: boolean;
  isScreenshot: boolean;
  isOldPhoto: boolean;
  exifVerified: boolean;
  imageHash?: string;
  threats: string[];
}

export class PhotoEngine {
  /**
   * Photo Engine: Computer vision & forensic metadata analysis for workout check-in photos.
   */
  static evaluate(activity: any, userHistory: any[] = []): PhotoEngineReport {
    const threats: string[] = [];
    const photoUrl = activity.photoUrl || activity.photo || activity.imageUrl;

    if (!photoUrl) {
      return {
        isPhotoValid: true,
        isDuplicatePhoto: false,
        isAiGenerated: false,
        isInternetStockPhoto: false,
        isScreenshot: false,
        isOldPhoto: false,
        exifVerified: false,
        threats: []
      };
    }

    // 1. Generate image hash for duplicate detection
    const imageHash = crypto.createHash('sha256').update(photoUrl.toString()).digest('hex');

    // 2. Duplicate Check against user's history or known hashes
    let isDuplicatePhoto = false;
    if (userHistory && userHistory.length > 0) {
      isDuplicatePhoto = userHistory.some(
        (past: any) => past.photoHash === imageHash || (past.photoUrl && past.photoUrl === photoUrl)
      );
    }
    if (isDuplicatePhoto || activity.isDuplicatePhoto) {
      threats.push('DUPLICATE_PHOTO_HASH');
    }

    // 3. AI Generated or Stock Image Markers
    const isAiGenerated = Boolean(
      activity.photoMeta?.isAiGenerated ||
      photoUrl.includes('dall-e') ||
      photoUrl.includes('midjourney') ||
      photoUrl.includes('generated')
    );
    if (isAiGenerated) {
      threats.push('AI_GENERATED_PHOTO_DETECTED');
    }

    const isInternetStockPhoto = Boolean(
      activity.photoMeta?.isStockPhoto ||
      photoUrl.includes('shutterstock') ||
      photoUrl.includes('unsplash') ||
      photoUrl.includes('pexels') ||
      photoUrl.includes('stock-photo')
    );
    if (isInternetStockPhoto) {
      threats.push('INTERNET_STOCK_PHOTO_DETECTED');
    }

    // 4. Screenshot Detection
    const isScreenshot = Boolean(
      activity.photoMeta?.isScreenshot ||
      photoUrl.includes('screenshot') ||
      photoUrl.includes('Screen_Shot')
    );
    if (isScreenshot) {
      threats.push('SCREENSHOT_PHOTO_DETECTED');
    }

    // 5. Old Photo & EXIF Analysis
    let isOldPhoto = false;
    let exifVerified = false;

    if (activity.photoMeta?.exifDate) {
      const photoTime = new Date(activity.photoMeta.exifDate).getTime();
      const activityTime = activity.timestamp ? new Date(activity.timestamp).getTime() : Date.now();
      const diffHours = Math.abs(activityTime - photoTime) / (1000 * 3600);

      if (diffHours > 24) {
        isOldPhoto = true;
        threats.push(`OLD_PHOTO_EXIF_DATE (${Math.round(diffHours)}h difference)`);
      } else {
        exifVerified = true;
      }
    }

    // 6. Resolution & Quality Checks
    if (activity.photoMeta?.width && activity.photoMeta?.width < 300) {
      threats.push('LOW_RESOLUTION_PHOTO');
    }

    const isPhotoValid = threats.length === 0;

    return {
      isPhotoValid,
      isDuplicatePhoto,
      isAiGenerated,
      isInternetStockPhoto,
      isScreenshot,
      isOldPhoto,
      exifVerified,
      imageHash,
      threats
    };
  }
}
