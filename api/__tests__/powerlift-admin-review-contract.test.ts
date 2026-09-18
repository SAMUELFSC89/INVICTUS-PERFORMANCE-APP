import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Power Lift admin review contract', () => {
  test('admin handler exposes review operations only after admin authority validation', () => {
    const handler = read('api/_handlers/admin.ts');
    const authorityCheck = handler.indexOf('hasActiveAdminAuthority(userData)');
    const listAction = handler.indexOf("case 'list-powerlift-reviews'");
    const reviewAction = handler.indexOf("case 'review-powerlift-record'");
    const videoAction = handler.indexOf("case 'get-powerlift-review-video'");

    expect(authorityCheck).toBeGreaterThan(-1);
    expect(listAction).toBeGreaterThan(authorityCheck);
    expect(reviewAction).toBeGreaterThan(authorityCheck);
    expect(videoAction).toBeGreaterThan(authorityCheck);
  });

  test('manual decision is monotonic and only accepts records still awaiting manual review', () => {
    const helper = read('api/_lib/powerlift-admin.ts');
    expect(helper).toContain("record.videoStatus !== 'manual_review'");
    expect(helper).toContain("decision !== 'approved' && decision !== 'rejected'");
    expect(helper).toContain("approvalSource: 'admin_manual_review'");
    expect(helper).toContain("source: 'admin_manual_review'");
  });

  test('review video uses a short-lived signed URL and validates the canonical storage prefix', () => {
    const helper = read('api/_lib/powerlift-admin.ts');
    expect(helper).toContain('10 * 60 * 1000');
    expect(helper).toContain('getSignedUrl');
    expect(helper).toContain('power_records/${safeText(record.userId, 128)}/');
  });
});
