// URLs of the unified task and time API on either side. kind: 'ticket' | 'project'.
export function workPaths(kind, parentId) {
  const base = kind === 'ticket' ? `/tickets/${parentId}` : `/projects/${parentId}`;
  const time = kind === 'ticket' ? `${base}/time` : `${base}/time-entries`;
  return {
    tasks: `${base}/tasks`,
    task: (id) => `${base}/tasks/${id}`,
    reorder: `${base}/tasks/reorder`,
    code: (id) => `${base}/tasks/${id}/code`,
    time,
    entry: (id) => `${time}/${id}`,
  };
}
