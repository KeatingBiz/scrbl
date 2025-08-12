// app/gallery/page.tsx
import TwoPaneShell from "@/components/TwoPaneShell";
import ScrblView from "@/components/views/ScrblView";
import ClassesView from "@/components/views/ClassesView";

export default function GalleryPage() {
  return <TwoPaneShell active={1} left={<ScrblView />} right={<ClassesView />} />;
}


