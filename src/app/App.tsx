import MarkdownRenderer from './components/MarkdownRenderer';
import readmeContent from '../../README.md?raw';
import { TestingControls } from './components/TestingControls';
import { ProcessingModeTester } from './components/ProcessingModeTester';
import { ExperimentTester } from './components/ExperimentTester';
import { Analytics } from './components/Analytics';

export default function App() {
  return (
    <div>
      <Analytics
        isEnabled={true}
        beaconSiteId="beacon-docs"
        beaconDebug={true}
        directEvents={false}
        directPageViews={false}
        batchSize={10}
        batchTimeout={1000}
      />
      <div className="container mx-auto px-4 py-8">
        <MarkdownRenderer content={readmeContent} />
      </div>
      <ProcessingModeTester />
      <ExperimentTester />
      <TestingControls />
    </div>
  );
}
