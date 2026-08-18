import React, { useState, useEffect } from 'react';

export default function JobFinder({ ctx }) {
  const [profile, setProfile] = useState(null);
  const [filters, setFilters] = useState({
    role: '',
    location: '',
    minCtc: '',
    minExp: '0',
    maxExp: '3',
    query: ''
  });
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState(null);
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'saved'
  const [savedJobs, setSavedJobs] = useState([]);

  // Fetch candidate profile to pre-fill filters
  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await ctx.API.get('/jobs/profile');
        if (data.success && data.profile) {
          setProfile(data.profile);
          setFilters(prev => ({
            ...prev,
            role: data.profile.desiredRole || data.profile.currentRole || '',
            location: data.profile.location || 'Surat',
            minCtc: data.profile.expectedCTC || '6 LPA',
            maxExp: String(Number(data.profile.yearsOfExperience || 2) + 2)
          }));
        }
      } catch (err) {
        console.warn('Failed to load profile for Job Finder:', err);
      }
    }

    async function loadSavedJobs() {
      try {
        const data = await ctx.API.get('/jobs/discovered');
        if (data.success && data.jobs) {
          setSavedJobs(data.jobs);
        }
      } catch (err) {
        console.warn('Failed to load saved jobs:', err);
      }
    }

    loadProfile();
    loadSavedJobs();
  }, []);

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (loading) return;

    setLoading(true);
    try {
      ctx.showToast('Searching jobs with Firecrawl & evaluating match...', 'info');
      const data = await ctx.API.post('/jobs/search', {
        role: filters.role,
        location: filters.location,
        minCtc: filters.minCtc,
        minExp: Number(filters.minExp || 0),
        maxExp: Number(filters.maxExp || 5),
        query: filters.query,
        limit: 10
      });

      if (data.success && data.jobs) {
        setJobs(data.jobs);
        setSavedJobs(prev => [...data.jobs, ...prev.filter(p => !data.jobs.some(j => j.url === p.url))]);
        ctx.showToast(`Found ${data.jobs.length} matching jobs!`, 'success');
      } else {
        ctx.showToast('No matching jobs found', 'warning');
      }
    } catch (err) {
      ctx.showToast(err.message || 'Job search failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoApply = async (job) => {
    setApplyingJobId(job.id || job.url);
    try {
      ctx.showToast(`Launching Auto-Apply for ${job.title}...`, 'info');
      const res = await ctx.API.post('/jobs/apply', { url: job.url });
      if (res.success) {
        ctx.showToast('Auto-apply agent started! Redirecting to live execution...', 'success');
        // Navigate to Apply tab to watch live automation
        setTimeout(() => {
          ctx.navigateTo('apply');
        }, 1200);
      } else {
        ctx.showToast(res.error || 'Failed to trigger apply', 'error');
      }
    } catch (err) {
      ctx.showToast(err.message, 'error');
    } finally {
      setApplyingJobId(null);
    }
  };

  const displayJobs = activeTab === 'search' ? jobs : savedJobs;

  return (
    <div className="animate-slide-up stack-lg">
      {/* Profile Overview Banner */}
      {profile && (
        <div className="card job-profile-banner">
          <div className="job-profile-content">
            <div className="job-profile-avatar">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div>
              <div className="job-profile-title">
                <span>{profile.name}</span>
                <span className="badge badge-teal">Resume Active</span>
              </div>
              <div className="job-profile-meta">
                <span>🎯 Target: <strong>{profile.desiredRole || profile.currentRole}</strong></span>
                <span>📍 <strong>{profile.location}</strong></span>
                <span>💰 Expected: <strong>{profile.expectedCTC}</strong></span>
                <span>⚡ Experience: <strong>{profile.yearsOfExperience} yrs</strong></span>
              </div>
            </div>
          </div>

          <div className="job-skills-preview">
            <span className="job-skills-label">Detected Skills ({profile.skills?.length || 0}):</span>
            <div className="job-skills-tags">
              {profile.skills?.slice(0, 8).map(skill => (
                <span key={skill} className="skill-chip active">{skill}</span>
              ))}
              {profile.skills?.length > 8 && (
                <span className="skill-chip more">+{profile.skills.length - 8} more</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter & Search Form */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Firecrawl Job Finder & Resume Matcher</div>
            <div className="card-subtitle">Search web job listings, filter by criteria, and calculate AI match score with your resume.</div>
          </div>
          <div className="tab-pills">
            <button
              type="button"
              className={`tab-pill ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              Search Results ({jobs.length})
            </button>
            <button
              type="button"
              className={`tab-pill ${activeTab === 'saved' ? 'active' : ''}`}
              onClick={() => setActiveTab('saved')}
            >
              Discovered History ({savedJobs.length})
            </button>
          </div>
        </div>

        {activeTab === 'search' && (
          <form onSubmit={handleSearch} className="job-filter-form">
            <div className="job-filter-grid">
              <div className="input-group">
                <label className="input-label" htmlFor="role-filter">Target Role / Keywords</label>
                <input
                  id="role-filter"
                  type="text"
                  className="input"
                  placeholder="e.g. Full Stack Developer, React Engineer"
                  value={filters.role}
                  onChange={(e) => setFilters(prev => ({ ...prev, role: e.target.value }))}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="location-filter">Location</label>
                <input
                  id="location-filter"
                  type="text"
                  className="input"
                  placeholder="e.g. Surat, Remote, India"
                  value={filters.location}
                  onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value }))}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="ctc-filter">Min Expected CTC</label>
                <input
                  id="ctc-filter"
                  type="text"
                  className="input"
                  placeholder="e.g. 6 LPA or $80,000"
                  value={filters.minCtc}
                  onChange={(e) => setFilters(prev => ({ ...prev, minCtc: e.target.value }))}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="max-exp-filter">Max Experience (Years)</label>
                <input
                  id="max-exp-filter"
                  type="number"
                  min="0"
                  max="20"
                  className="input"
                  placeholder="e.g. 3"
                  value={filters.maxExp}
                  onChange={(e) => setFilters(prev => ({ ...prev, maxExp: e.target.value }))}
                />
              </div>
            </div>

            <div className="job-filter-footer">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    <span>Crawling & Matching Jobs...</span>
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span>Find Matching Jobs</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Discovered Jobs List */}
      <div className="job-results-container">
        {displayJobs.length > 0 ? (
          <div className="job-cards-grid">
            {displayJobs.map((job) => {
              const isHighMatch = job.matchScore >= 80;
              const isMediumMatch = job.matchScore >= 60 && job.matchScore < 80;
              const matchBadgeClass = isHighMatch ? 'badge-green' : (isMediumMatch ? 'badge-teal' : 'badge-amber');

              return (
                <div key={job.id || job.url} className="card job-card animate-slide-up">
                  <div className="job-card-header">
                    <div className="job-card-title-group">
                      <h3 className="job-card-title">{job.title}</h3>
                      <div className="job-card-company-meta">
                        <span className="job-company-name">🏢 {job.company}</span>
                        <span className="job-location-tag">📍 {job.location}</span>
                        <span className="job-ctc-tag">💰 {job.ctc || 'Competitive'}</span>
                      </div>
                    </div>

                    <div className="job-card-match-badge">
                      <div className={`match-score-badge ${matchBadgeClass}`}>
                        <span className="match-score-num">{job.matchScore}%</span>
                        <span className="match-score-lbl">Match</span>
                      </div>
                    </div>
                  </div>

                  {/* Matching Skills */}
                  {job.matchingSkills && job.matchingSkills.length > 0 && (
                    <div className="job-matching-skills-box">
                      <span className="skills-subheading">Matching Skills:</span>
                      <div className="job-skills-tags">
                        {job.matchingSkills.map(skill => (
                          <span key={skill} className="skill-chip matched">✓ {skill}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Summary / Reasoning */}
                  {job.summary && (
                    <p className="job-summary-text">{job.summary}</p>
                  )}

                  {/* Actions */}
                  <div className="job-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleAutoApply(job)}
                      disabled={applyingJobId === (job.id || job.url)}
                    >
                      {applyingJobId === (job.id || job.url) ? (
                        <>
                          <span className="spinner" />
                          <span>Starting Agent...</span>
                        </>
                      ) : (
                        <>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                          </svg>
                          <span>Auto Apply Now</span>
                        </>
                      )}
                    </button>

                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                    >
                      <span>View Job Link ↗</span>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card empty-state">
            <div className="empty-state-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <h3>{loading ? 'Searching & Evaluating Jobs...' : 'No Jobs Discovered Yet'}</h3>
            <p>
              {loading
                ? 'Firecrawl is searching job listings across the web and matching them against your profile.json resume...'
                : 'Click "Find Matching Jobs" above to search web listings and match them with your skills & experience.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
