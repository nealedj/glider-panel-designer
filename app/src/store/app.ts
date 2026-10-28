/**
 * The app's single document store instance and React bindings.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Project } from '../model/schema';
import { projectGeometry, resolveTemplate } from '../model/resolve';
import sampleJson from '../../../fixtures/projects/sample.json';
import { DocStore } from './doc';
import { GRP_SUGGESTED } from '../checks/thresholds';

export function sampleProject(): Project {
  return Project.parse(sampleJson);
}

/** The wired sample: battery, switch, fuses, instruments, data links and pneumatics. Loaded on first use. */
export async function wiringSampleProject(): Promise<Project> {
  return Project.parse((await import('../../../fixtures/projects/wiring-sample.json')).default);
}

/** The reference PIK-20D T-panel on the cardboard mock-up template (M7): placeholder parts until reviewed. */
export async function pik20dProject(): Promise<Project> {
  return Project.parse((await import('../../../fixtures/projects/pik20d.json')).default);
}

export function blankProject(templateRef = { id: 'sample.rect-300x200', version: 1 }): Project {
  const now = new Date().toISOString();
  return Project.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: 'Untitled panel',
    created: now,
    modified: now,
    template: { ref: templateRef },
    settings: { ...GRP_SUGGESTED },
  });
}

export const docs = new DocStore(sampleProject());

export function useDoc(): Project {
  return useSyncExternalStore(docs.subscribe, () => docs.doc);
}

export function useHistory() {
  useSyncExternalStore(docs.subscribe, () => docs.version);
  return { canUndo: docs.past.length > 0, canRedo: docs.future.length > 0 };
}

export function useGeometry(doc: Project) {
  return useMemo(() => projectGeometry(doc), [doc]);
}

export function useTemplate(doc: Project) {
  return useMemo(() => resolveTemplate(doc), [doc.template]);
}
