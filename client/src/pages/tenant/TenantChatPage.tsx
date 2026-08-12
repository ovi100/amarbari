import { PageHeader } from '@/components/StatCard';
import { ChatPanel } from '@/components/ChatPanel';

export default function TenantChatPage() {
  return (
    <>
      <PageHeader
        title="Chat with your admin"
        description="The assistant answers common questions instantly; anything else goes straight to a person."
      />
      <ChatPanel partnerName="Property Admin" />
    </>
  );
}
