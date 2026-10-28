process.env.SEED_SAMPLE_DATA ??= 'true';
const { seedIfEmpty } = await import('../src/seed.js');
seedIfEmpty(); console.log('Seed complete (sample data is flagged and removable from Admin > Settings).');
