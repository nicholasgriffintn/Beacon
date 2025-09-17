import { useState } from 'react';

export function TestingControls() {
  const [showProcessing, setShowProcessing] = useState(false);
  const [showExperiments, setShowExperiments] = useState(false);

  const toggleProcessingTester = () => {
    setShowProcessing(prev => !prev);
    
    if (showExperiments) {
      setShowExperiments(false);
    }
    
    const processingTester = document.querySelector('.processing-mode-tester');
    if (processingTester) {
      (processingTester as HTMLElement).style.display = showProcessing ? 'none' : 'block';
    }
    
    const experimentTester = document.querySelector('.experiment-tester');
    if (experimentTester) {
      (experimentTester as HTMLElement).style.display = 'none';
    }
  };

  const toggleExperimentTester = () => {
    setShowExperiments(prev => !prev);
     
    if (showProcessing) {
      setShowProcessing(false);
    }
    
    const experimentTester = document.querySelector('.experiment-tester');
    if (experimentTester) {
      (experimentTester as HTMLElement).style.display = showExperiments ? 'none' : 'block';
    }
    
    const processingTester = document.querySelector('.processing-mode-tester');
    if (processingTester) {
      (processingTester as HTMLElement).style.display = 'none';
    }
  };

  return (
    <div className="testing-controls">
      <button
        type="button"
        onClick={toggleProcessingTester}
        className={`testing-controls__btn ${showProcessing ? 'active' : ''}`}
      >
        📊 Tester
      </button>
      <button
        type="button"
        onClick={toggleExperimentTester}
        className={`testing-controls__btn ${showExperiments ? 'active' : ''}`}
      >
        🧪 Experiments
      </button>
    </div>
  );
}