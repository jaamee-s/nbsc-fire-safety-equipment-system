import { useState } from 'react'
import { supabase } from './supabaseClient'

function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      setError(error.message)
    } else if (onLoginSuccess) {
      onLoginSuccess()
    }

    setLoading(false)
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">🔥</div>
        <h1>NBSC Fire Safety Equipment System</h1>
        <p className="login-subtitle">Equipment Inventory · Inspection · Maintenance Monitoring</p>

        <form onSubmit={handleLogin} className="form-grid" style={{ marginTop: '20px' }}>
          <div>
            <label className="field-label">Email</label>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="field-label">Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login