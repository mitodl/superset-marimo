// Licensed under BSD-3-Clause. See LICENSE in the project root.

/** Shape returned by GET /extensions/mitodl/marimo-notebooks/capabilities */
export interface Capabilities {
  can_create_notebooks: boolean;
  notebook_launch_mode: 'edit' | 'run';
}

/** A single notebook entry from GET /extensions/mitodl/marimo-notebooks/ */
export interface Notebook {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Shape returned by POST /extensions/mitodl/marimo-notebooks/ */
export interface CreateNotebookResult {
  notebook_id: string;
  launch_url: string;
}

/** Shape returned by GET|POST /extensions/mitodl/marimo-notebooks/:id/view|launch */
export interface LaunchResult {
  launch_url: string;
}

/** The database context passed from SQL Lab when opening a new notebook */
export interface DatabaseContext {
  db_id?: number;
  schema?: string;
  table?: string;
}
