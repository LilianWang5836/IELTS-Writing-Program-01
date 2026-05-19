import { ClientGate } from "@/components/ClientGate";
import { HomeContent } from "@/components/HomeContent";

export default function HomePage() {
  return (
    <ClientGate>
      <HomeContent />
    </ClientGate>
  );
}
