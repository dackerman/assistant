import { useState, useEffect } from 'react'

function App() {
  const [backendMessage, setBackendMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4001'
    
    // Add a small delay to ensure backend is ready
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/hello`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
        .then(res => {
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`)
          }
          return res.json()
        })
        .then(data => {
          setBackendMessage(data.message)
          setLoading(false)
        })
        .catch(err => {
          console.error('Failed to connect to backend:', err)
          setBackendMessage(`Failed to connect to backend: ${err.message}`)
          setLoading(false)
        })
    }, 1000) // Wait 1 second for backend to be ready

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Hello World</h1>
        <div className="text-lg">
          {loading ? (
            <p>Connecting to backend...</p>
          ) : (
            <p>{backendMessage}</p>
          )}
        </div>
        <p className="text-gray-600">
          Full-stack TypeScript app with Vite + Bun + Hono + Tailwind
        </p>
      </div>
    </div>
  )
}

export default App
