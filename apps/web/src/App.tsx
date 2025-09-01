import { ConversationView } from '@/components/chat/ConversationView'
import { mockConversation } from '@/data/mockConversation'

function App() {
  return <ConversationView conversation={mockConversation} />
}

export default App
