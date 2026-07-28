import { VARIANTS, createVariant } from './pack.js';

export const STYLE_INFO = { id: 'pack_fluffy', name: VARIANTS.fluffy.name, desc: VARIANTS.fluffy.desc };
export const createStyleAvatar = (config) => createVariant('fluffy', config);
