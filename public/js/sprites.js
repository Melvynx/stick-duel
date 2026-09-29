// Procedural pixel sprites (original art). Each gun faces right; anchors are in sprite px:
// grip = back hand, fore = front hand, muzzle = barrel tip.

import { gun, make } from './pixel.js';
import { TOOL_GUNS } from './sprites-tools.js';

export const GUNS = [
  gun(
    [
      '.kkkkkkkkkkk.',
      'kwwllllllllwk',
      'kmmmmmmmmmmmk',
      'kkdkkkkkkkkk.',
      '.kdk.k.......',
      '.kdkk........',
      '.kdk.........',
      '.kkk.........',
    ],
    [2, 5],
    [3, 4],
    [13, 1.5],
  ),
  gun(
    [
      '....kkkkkkkkkkk..',
      'kk.kwwlllllllllkk',
      'kmkkmmmmmmmmmmmck',
      'kmmmmmmmmmmmmmmck',
      'kkkkdkkkdkkkkkkk.',
      '...kdk.kbk.......',
      '...kdk.kbk.......',
      '...kkk.kkk.......',
    ],
    [4, 5],
    [8, 5],
    [17, 2.5],
  ),
  gun(
    [
      '.....kkkkkkkkkkkkkkkkkk',
      'kkkk.kwwllllllllllllllk',
      'knNnkkmmmmmmmmmmmmmmmyk',
      'knnNNmmmmkkkkkkkkkkkkk.',
      'kkkknmdk.kNNNNNNNk.....',
      '....kkdk..kkkkkkk......',
      '.....kdk...............',
      '.....kkk...............',
    ],
    [6, 5],
    [13, 4],
    [23, 1.5],
  ),
  gun(
    [
      '..kkkkkkkkkkkkkkkkkkkk..',
      '.kbbwwwlllllllllllllyyk.',
      'kkbbmmmmmmmmmmmmmmmmyyok',
      'kBbbmmmmmmmmmmmmmmmmyyok',
      'kkBBddddddddddddddddyyk.',
      '.kkkkkkdkkkkkdkkkkkkkk..',
      '......kdk...kbk.........',
      '......kdk...kkk.........',
      '......kkk...............',
    ],
    [7, 6],
    [13, 6],
    [24, 2.5],
  ),
  gun(
    [
      '...kkkkkkkkkkkkkkkkkkk...',
      '.kkwwllllllllllllllllwkk.',
      'kmmmmcmcmcmcmmmmmmmmmmmck',
      'kddmmcmcmcmcmmmmmmmmmmmck',
      '.kkdddddddddddddddkkkkkk.',
      '...kkdkkkkkkkdkk.........',
      '.....kdk....kbk..........',
      '.....kdk....kkk..........',
      '.....kkk.................',
    ],
    [6, 6],
    [13, 6],
    [25, 2.5],
  ),
  gun(
    [
      '...kkkkkkkkkkkkkk.....',
      '.kkwwllllllllllllkkkk.',
      'kmmmmmmmmmmmmmmmmmmmrk',
      'kdddmmmmmmmmmmmmmmmmrk',
      '.kkkkdkkoooooooookkkk.',
      '....kdkoyyyyyyyyyok...',
      '....kdkoooooooooook...',
      '....kkk.kkkkkkkkkk....',
    ],
    [5, 5],
    [12, 5],
    [22, 2.5],
  ),
  gun(
    [
      '..kkkkkkkkkkkkkkkkkkkkk..',
      '.kppwwllllllllllllllllpk.',
      'kkppmmmmmmmmmmmmmmmmmmyyk',
      'kpppmkmkmkmkmmmmmmmmmmyyk',
      'kkppmmmmmmmmmmmmmmmmmmyyk',
      '.kkkPddddddddddddddddkkk.',
      '....kkkkdkkkkkkbkkkk.....',
      '.......kdk....kbk........',
      '.......kdk....kkk........',
      '.......kkk...............',
    ],
    [8, 7],
    [15, 7],
    [25, 3],
  ),
  ...TOOL_GUNS,
];

export const JETPACK = make([
  '.kkkkk.',
  'kmllmmk',
  'kpppppk',
  'kmmmmmk',
  'kdmmmdk',
  'kpppppk',
  'kdmmmdk',
  'kdddddk',
  '.kmkmk.',
  '.kdkdk.',
  '.kk.kk.',
]);

export const GRENADE = make(['..kk.', '.kyk.', 'kmmmk', 'kmlmk', 'kGmGk', 'kmmmk', '.kkk.']);

export const ROCKET = make(['.kkkkkk...', 'kmwwllkk..', 'kmmmmmmyrk', 'kddddddkk.', '.kkkkkk...']);

export const MIRV = make([
  '.kkkkkkkk...',
  'kppwwllllkk.',
  'kpmmmmmmmyyk',
  'kpmmmmmmmyyk',
  'kPddddddddk.',
  '.kkkkkkkk...',
]);

export const BOMBLET = make(['.kk.', 'kyyk', 'kmmk', '.kk.']);

export const CHUTE = make([
  '..kkkkkkk..',
  '.kWpWpWpWk.',
  'kWpWpWpWpWk',
  'k.k..k..k.k',
  '.k.k.k.k.k.',
  '..k.kkk.k..',
]);

export const CRATE = make([
  'kkkkkkkkkkkk',
  'kNNNNNNNNNNk',
  'kNnnnnnnnnNk',
  'kNnWWWWWWnNk',
  'kNnWWrrWWnNk',
  'kNnWrrrrWnNk',
  'kNnWrrrrWnNk',
  'kNnWWrrWWnNk',
  'kNnWWWWWWnNk',
  'kNnnnnnnnnNk',
  'kNNNNNNNNNNk',
  'kkkkkkkkkkkk',
]);

export const CRATE_CHUTE = make([
  '...kkkkkkkkkk...',
  '.kkWoWoWoWoWokk.',
  'kWoWoWoWoWoWoWok',
  'kkkkkkkkkkkkkkkk',
  '.k....k..k....k.',
  '..k...k..k...k..',
  '...k..k..k..k...',
  '....k.k..k.k....',
]);

export const NADE_ICON = make([
  '...kk..',
  '..kyk..',
  '.kkkkk.',
  'kmmmmmk',
  'kmlmmmk',
  'kGmGmGk',
  'kmmmmmk',
  '.kkkkk.',
]);
