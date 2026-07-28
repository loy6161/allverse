import { VARIANTS, createVariant } from './pack.js';

export const STYLE_INFO = { id: 'pack_hood', name: VARIANTS.hood.name, desc: VARIANTS.hood.desc };
export const createStyleAvatar = (config) => createVariant('hood', config);
