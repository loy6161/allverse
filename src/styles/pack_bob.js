import { VARIANTS, createVariant } from './pack.js';

export const STYLE_INFO = { id: 'pack_bob', name: VARIANTS.bob.name, desc: VARIANTS.bob.desc };
export const createStyleAvatar = (config) => createVariant('bob', config);
