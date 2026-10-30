import { TypedEventBus } from '@kvl/shared';
import type { AudioEngineEvents } from './types';

/** Singleton bus for the audio engine — Phase 3 subscribes to `chunk:ready` here. */
export const audioEventBus = new TypedEventBus<AudioEngineEvents>();
