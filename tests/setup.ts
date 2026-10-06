import { vi } from 'vitest';
import '../src/lib/storage/node';

// Freeze "today" at 6 Oct 2026 (the date the v4 fixture was captured). Only Date is
// faked, so promises and IndexedDB callbacks still run normally.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
