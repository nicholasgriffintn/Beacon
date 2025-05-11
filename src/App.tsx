import MarkdownRenderer from './components/MarkdownRenderer';
import readmeContent from '../README.md?raw';
import { Analytics } from './components/Analytics';
import { ExperimentTester } from './components/ExperimentTester';

export default function App() {
  return (
    <div>
      <Analytics
        isEnabled={true}
        beaconSiteId="beacon-docs"
        beaconDebug={true}
      />
      <div className="container mx-auto px-4 py-8">
        <MarkdownRenderer content={readmeContent} />
      </div>
      <ExperimentTester />
    </div>
  );
}