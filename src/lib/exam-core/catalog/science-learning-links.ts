/** Exam V2 -- reviewed objective links for the IB science verticals (and their SL/HL variants share codes). */
import type { LearningLink } from './objective-learning-links';
import { PHYSICS_LEARNING_LINKS } from '../verticals/v2/ib-physics';
import { CHEMISTRY_LEARNING_LINKS } from '../verticals/v2/ib-chemistry';
import { BIOLOGY_LEARNING_LINKS } from '../verticals/v2/ib-biology';

export const SCIENCE_LEARNING_LINKS: Record<string, LearningLink> = { ...PHYSICS_LEARNING_LINKS, ...CHEMISTRY_LEARNING_LINKS, ...BIOLOGY_LEARNING_LINKS };
