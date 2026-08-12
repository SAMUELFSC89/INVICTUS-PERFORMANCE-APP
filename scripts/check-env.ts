console.log('Environment variables:');
Object.keys(process.env).forEach(key => {
  console.log(`${key}: ${process.env[key]}`);
});
