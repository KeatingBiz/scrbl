// app/page.tsx
import TwoPaneShell from "@/components/TwoPaneShell";
import ScrblView from "@/components/views/ScrblView";
import ClassesView from "@/components/views/ClassesView";

export default function Page() {
  return <TwoPaneShell active={0} left={<ScrblView />} right={<ClassesView />} />;
}



