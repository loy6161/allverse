import { createConceptAvatar } from './concept_factory.js';
export const STYLE_INFO = { name: 'Soft Pop', desc: '丸く親しみやすい、王道のデフォルメアバター。', badge: 'NEW' };
export const createStyleAvatar = (config) => createConceptAvatar('soft', config);
