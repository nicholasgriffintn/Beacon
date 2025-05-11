import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [message, setMessage] = useState<string>('Loading...')

  useEffect(() => {
    fetch('/api/hello')
      .then(response => response.json())
      .then(data => setMessage(data.message))
      .catch(error => {
        console.error('Error fetching API:', error)
        setMessage('Failed to connect to backend')
      })
  }, [])

  return (
    <div className="app">
      <h1>Beacon Dashboard</h1>
      <div className="card">
        <p>{message}</p>
      </div>
    </div>
  )
}

export default App 