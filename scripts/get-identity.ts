import http from 'http';

function getMetadata(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'metadata.google.internal',
      path: `/computeMetadata/v1/${path}`,
      headers: {
        'Metadata-Flavor': 'Google'
      }
    };
    const req = http.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`Status ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  try {
    const project = await getMetadata('project/project-id');
    console.log('Project ID from Metadata:', project);
    const email = await getMetadata('instance/service-accounts/default/email');
    console.log('Service Account Email:', email);
  } catch (e: any) {
    console.error('Failed to get metadata:', e.message);
  }
}

run();
