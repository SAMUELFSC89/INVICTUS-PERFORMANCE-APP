import { cors } from '../_lib/common.js';

export default async function handler(req: any, res: any) {
  const requestId = Math.random().toString(36).substring(7);
  
  if (cors(req, res)) return;

  try {
    const photoRef = req.query.ref as string;
    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;

    if (!photoRef) {
      console.warn(`[PhotoProxy][${requestId}] Missing ref query parameter`);
      return res.status(400).send('Missing photo reference');
    }

    if (!apiKey) {
      console.error(`[PhotoProxy][${requestId}] Google API Key not found in environment`);
      return res.status(500).send('Server configuration error: Missing API Key');
    }

    const isV1 = photoRef.startsWith('places/');
    let url: URL;
    const isInvalidV1 = isV1 && !photoRef.includes('/photos/');

    if (isV1) {
      if (isInvalidV1) {
        console.warn(`[PhotoProxy][${requestId}] Invalid V1 ref (place name instead of photo name): ${photoRef}`);
        return res.redirect('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=400&auto=format&fit=crop');
      }
      // Google Places API V1 Media Endpoint
      url = new URL(`https://places.googleapis.com/v1/${photoRef}/media`);
      url.searchParams.append('maxWidthPx', '800');
      // No maxHeight for now, let it be proportional
      console.log(`[PhotoProxy][${requestId}] Fetching from Places V1 API: ${photoRef.substring(0, 50)}...`);
    } else {
      // Google Places Photo Legacy Endpoint
      url = new URL('https://maps.googleapis.com/maps/api/place/photo');
      url.searchParams.append('maxwidth', '800');
      url.searchParams.append('photoreference', photoRef);
      url.searchParams.append('key', apiKey);
      console.log(`[PhotoProxy][${requestId}] Fetching from Legacy Google API: ${photoRef.substring(0, 30)}...`);
    }

    let finalUrl = url.toString();
    const headers: Record<string, string> = {
      'Accept': 'image/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
    };

    if (isV1) {
      // Resolve redirect manually to prevent forwarding the X-Goog-Api-Key header to the media storage CDN
      console.log(`[PhotoProxy][${requestId}] Resolving V1 redirect for Google API...`);
      const redirectRes = await fetch(finalUrl, {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'User-Agent': headers['User-Agent']
        },
        redirect: 'manual'
      });

      if (redirectRes.status === 307 || redirectRes.status === 302 || redirectRes.status === 301 || redirectRes.status === 308) {
        const redirectUrl = redirectRes.headers.get('location');
        if (redirectUrl) {
          finalUrl = redirectUrl;
          console.log(`[PhotoProxy][${requestId}] Successfully resolved redirect to: ${finalUrl.substring(0, 70)}...`);
        }
      } else if (!redirectRes.ok) {
        const errorInfo = await redirectRes.text().catch(() => 'no error body');
        console.error(`[PhotoProxy][${requestId}] Google API V1 Init Error: ${redirectRes.status} - KeyPrefix: ${apiKey.substring(0, 5)}`);
        console.error(`[PhotoProxy][${requestId}] V1 Init Error Body: ${errorInfo.substring(0, 500)}`);
        
        if (redirectRes.status === 403 || redirectRes.status === 404 || redirectRes.status === 400) {
          return res.redirect('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=400&auto=format&fit=crop');
        }
        return res.status(redirectRes.status).send(`Google API V1 Init Error: ${redirectRes.status}`);
      }
    }

    const response = await fetch(finalUrl, {
      redirect: 'follow',
      headers
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorInfo = '';
      
      if (contentType && contentType.startsWith('image/')) {
        errorInfo = '(Binary Image Content)';
      } else {
        errorInfo = await response.text().catch(() => 'no error body');
      }
      
      console.error(`[PhotoProxy][${requestId}] Google API Error: ${response.status} - KeyPrefix: ${apiKey.substring(0, 5)} - Ref: ${photoRef.substring(0, 60)}`);
      console.error(`[PhotoProxy][${requestId}] Full Error Body: ${errorInfo.substring(0, 500)}`);
      
      if (response.status === 403) {
        console.error(`[PhotoProxy][${requestId}] 403 Forbidden - Check if Places API (New) is enabled for V1 refs, or if the key is restricted.`);
      }
      
      // Fallback to a generic image if it's a known error status to avoid broken images in UI
      if (response.status === 403 || response.status === 404) {
        return res.redirect('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=400&auto=format&fit=crop');
      }

      return res.status(response.status).send(`Google API Error: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    console.log(`[PhotoProxy][${requestId}] Google response content-type: ${contentType}`);
    
    // If Google returns an image, the content-type should start with image/
    // If it's something else (like text/html), it might be an error page even with 200 OK
    if (contentType && !contentType.startsWith('image/')) {
      console.warn(`[PhotoProxy][${requestId}] Google returned non-image content: ${contentType}`);
      // If it's a small body, it might be an error message
    }

    const arrayBuffer = await response.arrayBuffer();
    
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.warn(`[PhotoProxy][${requestId}] Received empty body from Google`);
      return res.status(404).send('Not found');
    }

    console.log(`[PhotoProxy][${requestId}] Success: ${arrayBuffer.byteLength} bytes, type: ${contentType}`);

    const finalContentType = contentType || 'image/jpeg';
    res.setHeader('Content-Type', finalContentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    
    // Safety check: sometimes the body is actually an error JSON even with 200 (unlikely for photo API but good practice)
    const buffer = Buffer.from(arrayBuffer);
    return res.end(buffer);

  } catch (error: any) {
    console.error(`[PhotoProxy][${requestId}] CRITICAL ERROR:`, error);
    if (!res.headersSent) {
      // Fallback response instead of 500 if possible, or clear 500
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
