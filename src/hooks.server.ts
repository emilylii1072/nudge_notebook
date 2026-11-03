import { loadDotEnv } from '$lib/server/config';
import { stopAllKernels } from '$lib/server/kernel';

// Put .env into process.env before any route reads ANTHROPIC_API_KEY.
loadDotEnv();

process.on('exit', stopAllKernels);
