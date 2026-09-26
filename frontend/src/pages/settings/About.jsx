import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconBrandGithub, IconBug, IconStar, IconExternalLink } from '@tabler/icons-react';
import api from '../../api/api';

const REPO_URL = 'https://github.com/Stevy2191/PRISM';

// Pre-fills a new GitHub issue with the running build, so a report says which
// version it's about without the reporter having to go and find out.
function issueUrl(info) {
  const build = info
    ? `${info.version}${info.gitSha !== 'unknown' ? ` (commit ${info.gitSha})` : ''}`
    : 'unknown';
  const body = [
    `**PRISM version:** ${build}`,
    '',
    '**What happened?**',
    '',
    '',
    '**What did you expect to happen?**',
    '',
    '',
    '**Steps to reproduce**',
    '1. ',
  ].join('\n');
  return `${REPO_URL}/issues/new?body=${encodeURIComponent(body)}`;
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-navy-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-navy-900">{children}</dd>
    </div>
  );
}

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-prism hover:underline">
      {children}
      <IconExternalLink size={13} stroke={1.8} />
    </a>
  );
}

// About PRISM: which build this is, where the source lives, the license, and
// the two things a user might want to do about it — report a problem or star
// the project. Version comes from GET /version (the backend actually serving
// this page), same as the Settings footer.
export default function About() {
  const [info, setInfo] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get('/version').then(({ data }) => setInfo(data)).catch(() => setFailed(true));
  }, []);

  let version = <span className="text-navy-400">Loading…</span>;
  if (failed) version = <span className="text-navy-400">Unavailable</span>;
  if (info) {
    version = info.release ? (
      <ExternalLink href={`${REPO_URL}/tree/v${info.version}`}>
        <span className="font-mono">{info.version}</span>
      </ExternalLink>
    ) : (
      <span className="font-mono">
        {info.version} <span className="text-navy-400">· unreleased build</span>
      </span>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="page-title">About PRISM</h1>
        <p className="text-sm text-navy-500">Self-hosted ticketing and project management.</p>
      </div>

      <div className="card px-5 py-2">
        <dl className="divide-y divide-navy-100">
          <Row label="Version">{version}</Row>
          <Row label="Commit">
            {info && info.gitSha !== 'unknown' ? (
              <ExternalLink href={`${REPO_URL}/commit/${info.gitSha}`}>
                <span className="font-mono">{info.gitSha}</span>
              </ExternalLink>
            ) : (
              <span className="text-navy-400">{info ? 'Unknown' : '—'}</span>
            )}
          </Row>
          <Row label="Source code">
            <ExternalLink href={REPO_URL}>github.com/Stevy2191/PRISM</ExternalLink>
          </Row>
          <Row label="License">
            <ExternalLink href={`${REPO_URL}/blob/main/LICENSE`}>MIT License</ExternalLink>
          </Row>
        </dl>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-navy-900">Get involved</h2>
        <p className="mt-1 text-sm text-navy-500">
          Found a bug or have an idea? Open an issue on GitHub — your version is filled in for you.
          If PRISM is useful to you, a star helps others find it.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={issueUrl(info)} target="_blank" rel="noopener noreferrer" className="btn-primary">
            <IconBug size={16} stroke={1.8} />
            Report an issue
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <IconBrandGithub size={16} stroke={1.8} />
            <IconStar size={14} stroke={1.8} className="-ml-1" />
            Star on GitHub
          </a>
        </div>
      </div>

      <p className="text-xs text-navy-400">
        PRISM is free software, distributed under the MIT License. Copyright © 2026 sstevens117.
      </p>
    </div>
  );
}
