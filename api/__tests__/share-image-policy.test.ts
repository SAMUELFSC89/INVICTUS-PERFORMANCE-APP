import { trustedShareImageUrl } from '../_lib/share-image-policy';

describe('share-image-policy', () => {
  test.each([
    'https://firebasestorage.googleapis.com/v0/b/example/o/photo.jpg?alt=media',
    'https://storage.googleapis.com/example-bucket/photo.jpg',
  ])('accepts trusted Firebase/Google Storage image URL: %s', (value) => {
    expect(trustedShareImageUrl(value)?.toString()).toBe(value);
  });

  test.each([
    'http://firebasestorage.googleapis.com/v0/b/example/o/photo.jpg',
    'https://example.com/photo.jpg',
    'https://localhost/photo.jpg',
    'https://127.0.0.1/photo.jpg',
    'https://10.0.0.1/photo.jpg',
    'https://169.254.169.254/latest/meta-data',
    'file:///etc/passwd',
    'data:image/png;base64,AAAA',
    'not-a-url',
  ])('rejects untrusted remote source: %s', (value) => {
    expect(trustedShareImageUrl(value)).toBeNull();
  });
});
