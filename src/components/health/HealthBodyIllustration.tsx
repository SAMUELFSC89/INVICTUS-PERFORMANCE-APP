import { useId } from 'react';

/** Presentation-only silhouette of the existing 600 × 900 illustration.
 * The source bitmap stays unchanged. The SVG clips its backdrop and draws
 * a separate transparent arc; neither the arc nor the yellow regions
 * represent a measured recovery or muscle-load score.
 */
const BODY_OUTLINE = `
M300 22
C278 22 263 36 260 58 C258 77 260 98 267 108 L271 125
C265 137 247 147 230 158 C219 165 209 168 200 171 C188 177 180 188 175 204
C172 217 172 235 168 252 C163 279 156 307 148 335
L137 368 L130 400 C125 419 117 438 112 448
C105 455 102 470 103 482 L108 491 C111 494 114 489 115 482 L117 469
L116 512 C116 525 117 531 120 533 C124 535 128 532 127 527 L125 503
L128 532 C130 540 135 542 137 537 L137 509
L140 532 C143 538 148 536 149 531 L146 505
L151 522 C154 527 159 523 159 518 L155 493 C156 483 151 476 151 472
C162 457 165 446 170 429 C178 408 187 382 192 356
L201 329 C205 314 211 300 218 287
C228 310 225 335 224 360 L221 385
C216 405 211 427 207 453 C208 479 216 504 222 527
C225 548 225 566 224 586 C222 603 218 617 216 631
C209 654 204 678 202 701 C200 730 189 759 181 784
C177 796 176 809 175 818 C164 829 153 841 149 852
C145 859 150 867 161 870 L178 875 C190 875 202 869 208 859
C212 847 216 833 217 820 C221 807 219 799 216 786
C217 775 220 757 225 740 C229 721 238 711 243 699
C249 687 250 674 248 661 C246 650 245 640 248 626
C251 612 257 597 263 579 C267 563 269 552 276 538
C284 523 287 507 290 494 C291 482 294 471 300 466
C306 471 309 482 310 494 C313 507 316 523 324 538
C331 552 333 563 337 579 C343 597 349 612 352 626
C355 640 354 650 352 661 C350 674 351 687 357 699
C362 711 371 721 375 740 C380 757 383 775 384 786
C381 799 379 807 383 820 C384 833 388 847 392 859
C398 869 410 875 422 875 L439 870 C450 867 455 859 451 852
C447 841 436 829 425 818 C424 809 423 796 419 784
C411 759 400 730 398 701 C396 678 391 654 384 631
C382 617 378 603 376 586 C375 566 375 548 378 527
C384 504 392 479 393 453 C389 427 384 405 379 385
L379 385 L376 360 C375 335 372 310 382 287
C389 300 395 314 399 329 L408 356
C413 382 422 408 430 429 C435 446 438 457 449 472
C449 476 444 483 445 493 L441 518 C441 523 446 527 449 522 L454 505
L451 531 C452 536 457 538 460 532 L463 509
L463 537 C465 542 470 540 472 532 L475 503
L473 527 C472 532 476 535 480 533 C483 531 484 525 484 512 L483 469
L485 482 C486 489 489 494 492 491 L497 482 C498 470 495 455 488 448
C483 438 475 419 470 400 L463 368 L452 335
C444 307 437 279 432 252 C428 235 428 217 425 204
C420 188 412 177 400 171 C391 168 381 165 370 158 C353 147 335 137 329 125
L333 108 C340 98 342 77 340 58 C337 36 322 22 300 22 Z`;

function arc(start: number, end: number) {
  const at = (angle: number) => {
    const radians = angle * Math.PI / 180;
    return `${(300 + 272 * Math.cos(radians)).toFixed(2)} ${(430 + 272 * Math.sin(radians)).toFixed(2)}`;
  };
  return `M${at(start)} A272 272 0 ${end - start > 180 ? 1 : 0} 1 ${at(end)}`;
}

export function HealthBodyIllustration() {
  const id = useId();
  return <svg className="health-body-art" viewBox="0 0 600 900" role="img" aria-labelledby={`${id}-title ${id}-description`}>
    <title id={`${id}-title`}>Ilustração corporal de referência</title>
    <desc id={`${id}-description`}>Humanoide e arco sem plano de fundo. As cores são ilustrativas e não representam carga muscular ou recuperação medida.</desc>
    <defs><clipPath id={`${id}-body`} clipPathUnits="userSpaceOnUse"><path d={BODY_OUTLINE} /></clipPath></defs>
    <g fill="none" strokeWidth="17" aria-hidden="true">
      <circle cx="300" cy="430" r="272" stroke="#29291f" />
      <path d={arc(146, 217)} stroke="#6aab2b" />
      <path d={arc(322, 387)} stroke="#e9b837" />
      <path d={arc(387, 413)} stroke="#a84037" />
    </g>
    <image href="/assets/health/health-body-recovery-illustration-v1.webp" width="600" height="900" preserveAspectRatio="xMidYMid meet" clipPath={`url(#${id}-body)`} />
  </svg>;
}
