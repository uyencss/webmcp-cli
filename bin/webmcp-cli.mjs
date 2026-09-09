#!/usr/bin/env node

import process from 'node:process';
import { main } from '../lib/main.mjs';

process.exitCode = await main();
