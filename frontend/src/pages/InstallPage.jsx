import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useSettings } from '../context/SettingsContext';
import Spinner from '../components/Spinner';
import { detectSystem } from './installSystem';

// An install link (8d): fully public, like the survey page. The install key
// in the address is the credential. It offers the installer for this
// computer's system, named so it adds the computer to the company by itself.
const LINUX = [
  ['deb', 'Ubuntu, Debian'],
  ['rpm', 'Fedora, RHEL'],
  ['pacman', 'Arch'],
];
const mb = (bytes) => `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

export default function InstallPage() {
  const { key } = useParams();
  const { settings } = useSettings();
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [system, setSystem] = useState(() => detectSystem(navigator));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.get(`/install/${encodeURIComponent(key)}`)
      .then(({ data }) => setLink(data))
      .catch((err) => setError(errMessage(err, 'This install link no longer works. Ask your IT team for a new one.')));
  }, [key]);

  const appName = settings?.appName || settings?.branding?.appName || 'PRISM';
  const base = `/api/v1/install/${encodeURIComponent(key)}`;
  const linuxCommand = link ? `curl -fsSL ${link.url}${base}/linux.sh | sudo sh` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(linuxCommand); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-50 px-4 py-10">
      <main className="w-full max-w-md rounded-[10px] border border-navy-100 bg-surface p-6 shadow-sm sm:p-8">
        <p className="mb-5 text-center text-sm font-semibold text-navy-900">{appName}</p>
        {!link && !error && <div className="flex justify-center py-10"><Spinner /></div>}
        {error && (
          <div className="text-center">
            <h1 className="text-lg font-bold text-navy-900">Link not working</h1>
            <p className="mt-2 text-sm text-navy-600">{error}</p>
          </div>
        )}
        {link && (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-lg font-bold text-navy-900">Install the {appName} agent</h1>
              <p className="mt-1 text-sm text-navy-600">
                For <b>{link.company.name}</b>. It lets IT see this computer&apos;s details and gives you <b>Submit a ticket</b>.
              </p>
            </div>
            <div role="tablist" aria-label="System" className="flex justify-center gap-1">
              {[['windows', 'Windows'], ['macos', 'Mac'], ['linux', 'Linux']].map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={system === s}
                  onClick={() => setSystem(s)}
                  className={`h-8 rounded-md px-3 text-sm ${system === s ? 'bg-prism font-semibold text-white' : 'text-navy-600 hover:bg-navy-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {system === 'windows' && (link.windows ? (
              <div className="space-y-3 text-center">
                <a className="btn-primary inline-flex h-11 items-center px-5" href={`${base}/windows`}>Download for Windows ({mb(link.windows.size)})</a>
                <ol className="m-0 list-decimal space-y-1 pl-5 text-left text-sm text-navy-700">
                  <li>Open the downloaded file.</li>
                  <li>When Windows asks, allow it. If you aren&apos;t an administrator, IT types an administrator&apos;s name and password there.</li>
                  <li>That&apos;s all: the PRISM icon appears by the clock.</li>
                </ol>
              </div>
            ) : <p className="text-center text-sm text-navy-600">There&apos;s no Windows installer yet. Ask your IT team.</p>)}
            {system === 'macos' && (link.macos ? (
              <div className="space-y-3 text-center">
                <a className="btn-primary inline-flex h-11 items-center px-5" href={`${base}/mac`}>Download for Mac ({mb(link.macos.size)})</a>
                <ol className="m-0 list-decimal space-y-1 pl-5 text-left text-sm text-navy-700">
                  <li>Open the downloaded package. If macOS stops it, open <b>System Settings → Privacy &amp; Security</b>, click <b>Open Anyway</b>, and open it again.</li>
                  <li>Install it with an administrator&apos;s password (IT can type it for you).</li>
                  <li>That&apos;s all: the PRISM icon appears in the menu bar.</li>
                </ol>
              </div>
            ) : <p className="text-center text-sm text-navy-600">There&apos;s no Mac package yet. Ask your IT team.</p>)}
            {system === 'linux' && (
              <div className="space-y-3">
                <p className="m-0 text-sm text-navy-700">In a terminal, as someone who can use <code>sudo</code>:</p>
                <pre aria-label="Install command" className="m-0 whitespace-pre-wrap break-all rounded-lg border border-navy-100 bg-navy-50 p-3 font-mono text-[12.5px] text-navy-900">{linuxCommand}</pre>
                <div className="flex justify-center"><button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
                <p className="m-0 text-xs text-navy-500">
                  It picks the package for {LINUX.filter(([f]) => link.linux[f] && (link.linux[f].amd64 || link.linux[f].arm64)).map(([, l]) => l).join(', ') || 'your system'} and installs it.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
