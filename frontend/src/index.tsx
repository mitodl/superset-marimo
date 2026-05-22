// Licensed under BSD-3-Clause. See LICENSE in the project root.
/**
 * Extension entry point — loaded by Superset via Module Federation.
 *
 * All registrations (views, commands, menus) must be called here or
 * imported and executed from here.  Superset loads './index' from the
 * Module Federation container at runtime.
 */
import React from 'react';
import { commands, menus, sqlLab, views } from '@apache-superset/core';
import NotebookPanel from './NotebookPanel';
import type { DatabaseContext } from './types';

// ---------------------------------------------------------------------------
// Register the notebooks panel in SQL Lab's Panels area
// ---------------------------------------------------------------------------
views.registerView(
  { id: 'mitodl.marimo-notebooks.panel', name: 'Notebooks' },
  'sqllab.panels',
  () => {
    // Forward the active SQL Lab tab's database context to the panel so
    // "New Notebook" can pre-connect to the right data source.
    const currentTab = sqlLab.getCurrentTab();
    const context: DatabaseContext | undefined = currentTab
      ? {
          db_id: currentTab.databaseId ?? undefined,
          schema: (currentTab as unknown as { schema?: string }).schema ?? undefined,
        }
      : undefined;

    return <NotebookPanel context={context} />;
  },
);

// ---------------------------------------------------------------------------
// Register a "Open in Notebook" command for the SQL Lab editor toolbar
// ---------------------------------------------------------------------------
commands.registerCommand(
  {
    id: 'mitodl.marimo-notebooks.open-in-notebook',
    title: 'Open in Notebook',
    icon: 'BookOutlined',
    description:
      'Open the current query and database context in a Marimo notebook',
  },
  async () => {
    const tab = sqlLab.getCurrentTab();
    if (!tab) return;

    const { authentication } = await import('@apache-superset/core');
    const csrfToken = await authentication.getCSRFToken();

    const res = await fetch('/extensions/mitodl/marimo-notebooks/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
      },
      body: JSON.stringify({ db_id: tab.databaseId }),
    });

    if (res.ok) {
      const data = await res.json();
      window.open(data.result.launch_url, '_blank', 'noopener,noreferrer');
    }
  },
);

// Add the command to the SQL Lab editor toolbar (secondary / "···" menu)
menus.registerMenuItem(
  {
    view: 'builtin.editor',
    command: 'mitodl.marimo-notebooks.open-in-notebook',
  },
  'sqllab.editor',
  'secondary',
);
