/** Street names read off the grid, and how a person takes to a stranger. */

import { describe, expect, it } from 'vitest';
import { StreetNames } from '../streets.js';
import { dispositionOf, willingTo } from '../disposition.js';

const GRID = {
  edges: [
    { id: 'n1', class: 'road', path: [[0, 0], [100, 0]] as [number, number][] },
    { id: 'n2', class: 'road', path: [[100, 0], [200, 0]] as [number, number][] },
    { id: 's1', class: 'street', path: [[0, 120], [200, 120]] as [number, number][] },
    { id: 'w1', class: 'road', path: [[0, 0], [0, 120]] as [number, number][] },
    { id: 'e1', class: 'street', path: [[200, 0], [200, 120]] as [number, number][] },
    { id: 'a1', class: 'alley', path: [[60, 0], [60, 40]] as [number, number][] },
    { id: 'h1', class: 'highway', path: [[0, 60], [200, 60]] as [number, number][], level: 8 },
  ],
};

describe('StreetNames', () => {
  it('numbers the lines of the grid, Streets from the north and Avenues from the west, one name per line', () => {
    const names = new StreetNames(GRID);
    expect(names.ofEdge('n1')?.name).toBe('First Street');
    expect(names.ofEdge('n2')?.name).toBe('First Street');
    expect(names.ofEdge('s1')?.name).toBe('Second Street');
    expect(names.ofEdge('w1')?.name).toBe('First Avenue');
    expect(names.ofEdge('e1')?.name).toBe('Second Avenue');
    expect(names.ofEdge('a1')?.name).toBe('an alley');
    expect(names.ofEdge('h1')?.name).toBe('the highway');
  });

  it('places a point on its street at the nearest corner, off an alley when one is nearer, and never on the highway deck', () => {
    const names = new StreetNames(GRID);
    const spot = names.near(185, 5)!;
    expect(spot.street.name).toBe('First Street');
    expect(spot.cross?.name).toBe('Second Avenue');
    expect(spot.crossMetres).toBeCloseTo(15);
    expect(names.near(62, 30)).toMatchObject({ alley: true });
    expect(names.near(100, 61)!.street.kind).not.toBe('highway');
    expect(names.near(100, 10, 's1')!.street.name).toBe('Second Street');
  });

  it('turns with a rotated grid', () => {
    const angle = Math.PI / 2;
    const names = new StreetNames({ edges: [{ id: 'x', class: 'road', path: [[0, 0], [0, 100]] }] }, angle);
    expect(names.ofEdge('x')?.name).toBe('First Street');
  });
});

describe('dispositionOf', () => {
  it('reads warmth from traits and the kind of person, and decides requests by privacy', () => {
    expect(dispositionOf({ traits: ['warm', 'helpful'] })).toBe('friendly');
    expect(dispositionOf({ traits: ['quiet', 'frugal'] })).toBe('neutral');
    expect(dispositionOf({ traits: ['guarded', 'punctual'] })).toBe('wary');
    expect(dispositionOf({ traits: ['suspicious', 'brusque'] })).toBe('hostile');
    expect(dispositionOf({ traits: ['calm', 'fair'] }, 'authority')).toBe('neutral');
    expect(dispositionOf({ traits: ['stern', 'watchful'] }, 'authority')).toBe('hostile');
    expect(willingTo('friendly', 'home')).toBe(true);
    expect(willingTo('neutral', 'home')).toBe(false);
    expect(willingTo('neutral', 'work')).toBe(true);
    expect(willingTo('wary', 'public')).toBe(true);
    expect(willingTo('wary', 'follow')).toBe(false);
    expect(willingTo('hostile', 'public')).toBe(false);
  });
});
