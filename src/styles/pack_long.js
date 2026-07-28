import { VARIANTS, createVariant } from './pack.js';

export const STYLE_INFO = { id: 'pack_long', name: VARIANTS.longhair.name, desc: VARIANTS.longhair.desc };
export const createStyleAvatar = (config) => createVariant('longhair', config);
