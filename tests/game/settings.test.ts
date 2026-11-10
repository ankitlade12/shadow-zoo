import { describe, expect, it } from 'vitest';
import { freshSave } from '../../src/core/save.js';
import { ConfirmGuard, cycleSetting, settingLabel } from '../../src/game/Settings.js';

describe('settings', () => {
  it('cycles every setting and labels it in plain ASCII', () => {
    const s = freshSave().settings;
    expect(settingLabel(s, 'assist')).toBe('Assist: Normal');
    cycleSetting(s, 'assist');
    expect(s.assist).toBe('expert');
    cycleSetting(s, 'assist');
    expect(settingLabel(s, 'assist')).toBe('Assist: Gentle');
    cycleSetting(s, 'hand');
    expect(settingLabel(s, 'hand')).toBe('Hand: Left');
    cycleSetting(s, 'sound');
    expect(settingLabel(s, 'sound')).toBe('Sound: Off');
    cycleSetting(s, 'motion');
    expect(settingLabel(s, 'motion')).toBe('Motion: Reduced');
    cycleSetting(s, 'view');
    expect(settingLabel(s, 'view')).toBe('View: Narrow');
    for (const key of ['assist', 'hand', 'sound', 'motion', 'view'] as const) expect(settingLabel(s, key)).toMatch(/^[\x20-\x7e]+$/);
  });

  it('confirms a destructive action only on a second tap within the window', () => {
    const g = new ConfirmGuard(4);
    expect(g.tap(10)).toBe('armed');
    expect(g.isArmed(13)).toBe(true);
    expect(g.tap(13)).toBe('confirmed');
    expect(g.isArmed(13.5)).toBe(false);
    expect(g.tap(20)).toBe('armed');
    expect(g.tap(30)).toBe('armed');
  });
});
