// Sprites for the sandbox tools (weapon indices 7+) and the new pickups. Same conventions as
// sprites.js: guns face right, anchors are [grip, fore, muzzle] in sprite px.
import { gun, make } from './pixel.js';

export const TOOL_GUNS = [
  // 7 cutter: plasma torch with a glowing tip.
  gun(
    [
      '..kkkkkkkkkkkkkk....',
      '.kllwwwwllllllmkkk..',
      'kmmmmmmmmmmmmmmkcckk',
      'kddmmmmmmmmmmmmkcWck',
      '.kkkkdkkkkbkkkkkcckk',
      '....kdk..kbk....kk..',
      '....kdk..kkk........',
      '....kkk.............',
    ],
    [5, 5],
    [10, 5],
    [19, 3],
  ),
  // 8 builder: hazard-striped block press.
  gun(
    [
      '.kkkkkkkkkkkkkk..',
      'kyykyykyykyykykk.',
      'kyooooooooooooykk',
      'kyoNNNNNNNNNNoymk',
      'kyyyyyyyyyyyyyykk',
      '.kkkkdkkkkkkkkk..',
      '....kdk..........',
      '....kkk..........',
    ],
    [5, 5],
    [10, 4],
    [17, 3],
  ),
  // 9 sandstorm: sand tank feeding a blower nozzle.
  gun(
    [
      '..kkkkkkk............',
      '.kaaaaaaak.kkkkkkkkk.',
      'kaAaaaaaaAkkllllllllk',
      'kaaaaaaaaakmmmmmmmmmkk',
      'kaAaaaaaaAkmmmmmmmmmak',
      '.kaaaaaaakkddddddddkk.',
      '..kkkkkkkkdk.........',
      '.........kdk.........',
      '.........kkk.........',
    ],
    [10, 7],
    [14, 5],
    [21, 3.5],
  ),
  // 10 c4: detonator with antenna.
  gun(
    [
      '........kk',
      '.......krk',
      '......kk..',
      '.kkkkkkk..',
      'kmmmmmmmk.',
      'kmrmgmmmk.',
      'kmmmmmmmk.',
      'kkkdkkkkk.',
      '..kdk.....',
      '..kkk.....',
    ],
    [3, 8],
    [6, 6],
    [8, 2],
  ),
  // 11 quake: heavy purple shell launcher.
  gun(
    [
      '..kkkkkkkkkkkkkkkkkkk..',
      '.kvvwwllllllllllllvvkk.',
      'kkvvmmmmmmmmmmmmmmvvVkk',
      'kVvvmmmmmmmmmmmmmmvvVWk',
      'kkvvddddddddddddddvvVkk',
      '.kkkkkdkkkkkbkkkkkkkk..',
      '.....kdk...kbk.........',
      '.....kkk...kkk.........',
    ],
    [6, 6],
    [12, 6],
    [23, 3],
  ),
];

export const C4_CHARGE = make(['.kkkkk.', 'knNNNnk', 'kWkWkWk', 'knnnnnk', '.kkkkk.']);
export const C4_LIGHT = make(['r']);

export const QUAKE_SHELL = make(['.kkkkkk...', 'kvvvvvvkk.', 'kVvWvvvvvk', 'kvvvvvvkk.', '.kkkkkk...']);

export const AMMO_BOX = make([
  'kkkkkkkkk',
  'kGGGGGGGk',
  'kGgggggGk',
  'kkkkkkkkk',
  'kgyykyygk',
  'kgyykyygk',
  'kgggggggk',
  'kkkkkkkkk',
]);

export const PACK = make(['..kkk..', '.kmmmk.', 'kmlllmk', 'kmyyymk', 'kmlllmk', 'kmmmmmk', '.kkkkk.']);

// Hotbar lock glyph.
export const LOCK = make(['.kkk.', 'kl.lk', 'kl.lk', 'kkkkk', 'kyyyk', 'kykyk', 'kkkkk']);
