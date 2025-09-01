import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders conversation view', () => {
    render(<App />)
    expect(screen.getByText('System Setup & Task Management')).toBeInTheDocument()
    expect(screen.getAllByText('You')).toHaveLength(3) // Multiple user messages
    expect(screen.getAllByText('Assistant')).toHaveLength(4) // Multiple assistant messages
    expect(screen.getByText('System')).toBeInTheDocument() // System message
  })
})