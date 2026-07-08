// Labor cost is only ever calculated for contractors with a set hourly rate —
// internal staff always cost null (not 0, so reports can distinguish "no
// cost tracked" from "cost tracked and happens to be zero").
function calculateLaborCost(user, { durationSeconds, minutes } = {}) {
  if (!user || user.userType !== 'contractor' || user.hourlyRate === null || user.hourlyRate === undefined) {
    return null;
  }
  const seconds = durationSeconds !== null && durationSeconds !== undefined ? durationSeconds : (minutes || 0) * 60;
  const hours = seconds / 3600;
  return Math.round(hours * Number(user.hourlyRate) * 100) / 100;
}

module.exports = { calculateLaborCost };
