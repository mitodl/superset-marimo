// Licensed under BSD-3-Clause. See LICENSE in the project root.
import React, { useCallback, useEffect, useState } from 'react';
import { authentication } from '@apache-superset/core';
import type {
  Capabilities,
  CreateNotebookResult,
  DatabaseContext,
  LaunchResult,
  Notebook,
} from './types';

const API_BASE = '/extensions/mitodl/marimo-notebooks';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const csrfToken = await authentication.getCSRFToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface NotebookListProps {
  notebooks: Notebook[];
  onOpen: (notebook: Notebook) => void;
  loading: boolean;
}

const NotebookList: React.FC<NotebookListProps> = ({ notebooks, onOpen, loading }) => {
  if (loading) {
    return <div style={styles.status}>Loading notebooks…</div>;
  }
  if (notebooks.length === 0) {
    return <div style={styles.status}>No notebooks yet.</div>;
  }
  return (
    <ul style={styles.list}>
      {notebooks.map(nb => (
        <li key={nb.id} style={styles.listItem}>
          <button
            style={styles.notebookButton}
            onClick={() => onOpen(nb)}
            type="button"
          >
            📓 {nb.name}
          </button>
          <span style={styles.timestamp}>
            {new Date(nb.updated_at).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface NotebookPanelProps {
  /** Optional database context forwarded from SQL Lab's current tab */
  context?: DatabaseContext;
}

const NotebookPanel: React.FC<NotebookPanelProps> = ({ context }) => {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  // Fetch capabilities and notebook list in parallel on mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [capRes, listRes] = await Promise.all([
          apiFetch<{ result: Capabilities }>('/capabilities'),
          apiFetch<{ result: Notebook[] }>('/'),
        ]);
        if (!cancelled) {
          setCapabilities(capRes.result);
          setNotebooks(listRes.result ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch<{ result: CreateNotebookResult }>('/', {
        method: 'POST',
        body: JSON.stringify(context ?? {}),
      });
      window.open(res.result.launch_url, '_blank', 'noopener,noreferrer');
      // Refresh the list after creation.
      const listRes = await apiFetch<{ result: Notebook[] }>('/');
      setNotebooks(listRes.result ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create notebook');
    } finally {
      setCreating(false);
    }
  }, [context]);

  const handleOpen = useCallback(async (notebook: Notebook) => {
    setError(null);
    try {
      // Use write (edit) or read (view) endpoint based on capabilities.
      const canEdit = capabilities?.notebook_launch_mode === 'edit';
      const res = canEdit
        ? await apiFetch<{ result: LaunchResult }>(`/${notebook.id}/launch`, { method: 'POST' })
        : await apiFetch<{ result: LaunchResult }>(`/${notebook.id}/view`);
      setActiveUrl(res.result.launch_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open notebook');
    }
  }, [capabilities]);

  const handleCloseViewer = useCallback(() => setActiveUrl(null), []);

  // ------ render ------

  if (activeUrl) {
    return (
      <div style={styles.container}>
        <div style={styles.viewerHeader}>
          <button type="button" onClick={handleCloseViewer} style={styles.backButton}>
            ← Back to notebooks
          </button>
        </div>
        <iframe
          src={activeUrl}
          style={styles.iframe}
          title="Marimo Notebook"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Notebooks</h3>
        {/* Only render the create button when capabilities confirm can_write */}
        {capabilities?.can_create_notebooks && (
          <button
            type="button"
            style={styles.createButton}
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'Creating…' : '+ New Notebook'}
          </button>
        )}
      </div>

      {error && (
        <div style={styles.error} role="alert">
          {error}
        </div>
      )}

      {context?.db_id && (
        <div style={styles.contextBadge}>
          Connected to database {context.db_id}
          {context.table && ` · ${context.schema ? `${context.schema}.` : ''}${context.table}`}
        </div>
      )}

      <NotebookList
        notebooks={notebooks}
        onOpen={handleOpen}
        loading={listLoading}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles (inline — no CSS module dependency on host)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: 'inherit',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #f0f0f0',
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
  },
  createButton: {
    padding: '4px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    borderRadius: '4px',
    border: '1px solid #1677ff',
    background: '#1677ff',
    color: '#fff',
  },
  error: {
    margin: '8px 16px',
    padding: '8px',
    background: '#fff2f0',
    border: '1px solid #ffccc7',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#a8071a',
  },
  contextBadge: {
    margin: '8px 16px 0',
    padding: '4px 8px',
    background: '#f6ffed',
    border: '1px solid #b7eb8f',
    borderRadius: '4px',
    fontSize: '11px',
    color: '#135200',
  },
  status: {
    padding: '16px',
    color: '#8c8c8c',
    fontSize: '13px',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '8px 0',
    overflowY: 'auto',
    flex: 1,
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 16px',
    borderBottom: '1px solid #fafafa',
  },
  notebookButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#1677ff',
    padding: 0,
    textAlign: 'left',
  },
  timestamp: {
    fontSize: '11px',
    color: '#8c8c8c',
  },
  viewerHeader: {
    padding: '8px 16px',
    borderBottom: '1px solid #f0f0f0',
  },
  backButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#1677ff',
    padding: 0,
  },
  iframe: {
    flex: 1,
    width: '100%',
    border: 'none',
    height: '100%',
  },
};

export default NotebookPanel;
