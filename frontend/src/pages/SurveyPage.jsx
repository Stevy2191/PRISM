import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { IconStar, IconStarFilled } from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { useSettings } from '../context/SettingsContext';
import Spinner from '../components/Spinner';

// Fully public page — reached via an emailed CSAT survey link, no PRISM
// login involved. Deliberately does not render inside <Layout> (see
// App.jsx's top-level <Route path="/survey/:token">, alongside /login).
export default function SurveyPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const { settings } = useSettings();

  const [loading, setLoading] = useState(true);
  const [survey, setSurvey] = useState(null); // { status, question, ticketNumber, ticketTitle, companyName }
  const [loadError, setLoadError] = useState('');

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.get(`/survey/${token}`)
      .then(({ data }) => {
        setSurvey(data);
        const preRating = Number(searchParams.get('rating'));
        if (preRating >= 1 && preRating <= 5) setRating(preRating);
      })
      .catch((err) => setLoadError(errMessage(err, 'This survey could not be found.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) {
      setSubmitError('Please select a star rating.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.post(`/survey/${token}`, { rating, comment: comment.trim() || undefined });
      setSubmitted(true);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'ALREADY_RESPONDED') {
        setSurvey((s) => ({ ...s, status: 'responded' }));
      } else if (code === 'EXPIRED') {
        setSurvey((s) => ({ ...s, status: 'expired' }));
      } else {
        setSubmitError(errMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const appName = settings?.appName || settings?.branding?.appName || 'PRISM';
  const logoUrl = settings?.logoUrl;

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-50 px-4 py-10">
      <div className="w-full max-w-md rounded-[10px] border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          {logoUrl ? (
            <img src={logoUrl} alt={appName} className="h-10 w-10 object-contain" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-prism text-sm font-bold text-white">
              {appName.slice(0, 1)}
            </div>
          )}
          <p className="text-sm font-semibold text-navy-900">{appName}</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : loadError ? (
          <StatusMessage title="Survey not found" body={loadError} />
        ) : submitted ? (
          <StatusMessage
            title="Thank you!"
            body="Thank you for your feedback! Your response helps us improve our service."
            success
          />
        ) : survey.status === 'responded' ? (
          <StatusMessage title="Already completed" body="This survey has already been completed." />
        ) : survey.status === 'expired' ? (
          <StatusMessage title="Link expired" body="This survey link has expired." />
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="text-center">
              <h1 className="text-lg font-bold text-navy-900">Thank you for using our support services</h1>
              {survey.ticketNumber && (
                <p className="mt-1 text-xs text-navy-400">
                  Ticket #{survey.ticketNumber} — {survey.ticketTitle}
                </p>
              )}
              <p className="mt-3 font-medium text-navy-800">{survey.question}</p>
            </div>

            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => {
                const filled = n <= (hoverRating || rating);
                const Icon = filled ? IconStarFilled : IconStar;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    className="flex h-12 w-12 items-center justify-center rounded-md transition hover:bg-navy-50"
                  >
                    <Icon size={34} style={{ color: filled ? '#f59e0b' : '#cbd5e1' }} />
                  </button>
                );
              })}
            </div>

            <div>
              <label className="label">Tell us more (optional)</label>
              <textarea
                className="input resize-y"
                style={{ minHeight: '90px' }}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={5000}
                placeholder="What went well? What could we do better?"
              />
            </div>

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function StatusMessage({ title, body, success }) {
  return (
    <div className="py-6 text-center">
      <h1 className={`text-lg font-bold ${success ? 'text-green-600' : 'text-navy-900'}`}>{title}</h1>
      <p className="mt-2 text-sm text-navy-500">{body}</p>
    </div>
  );
}
