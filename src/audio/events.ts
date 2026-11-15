import type { GameEvent } from '../game/events.js';
import type { BonkLevel, SoundName } from './recipes.js';

/** The sound each game event makes: in the headset, in the desktop preview and in the zoo walk. */
export function soundFor(event: GameEvent): SoundName {
  switch (event.type) {
    case 'voice':
      return `voice-${event.species}`;
    case 'reveal':
      return 'reveal';
    case 'eat':
      return 'eat';
    case 'pet':
      return 'pet';
    case 'flee':
      return 'flee';
    case 'firefly':
      return 'firefly';
    // A grabbed creature protests in its own voice.
    case 'grab':
      return `voice-${event.species}`;
    case 'fling':
      return 'whoosh';
    case 'bonk':
      return `bonk-${Math.min(5, Math.max(1, event.combo)) as BonkLevel}`;
    case 'land':
      return 'thud';
    case 'clap':
      return 'clap';
    case 'globe':
      return 'globe';
    case 'travel':
      return 'travel';
    case 'stamp':
      return 'stamp';
    case 'gate':
      return 'gate';
    case 'feeding':
      return 'bell';
    case 'show':
      return 'applause';
  }
}
