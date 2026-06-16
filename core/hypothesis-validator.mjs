export class HypothesisValidator {
  validate(input = {}) {
    const predictedOutcome = String(input.predictedOutcome || '').toLowerCase();
    const observedOutcome = String(input.observedOutcome || '').toLowerCase();

    if (!predictedOutcome || !observedOutcome) {
      return { status: 'UNCERTAIN', confidenceDelta: -0.05, explanation: 'insufficient evidence' };
    }

    if (observedOutcome === 'unclear outcome') {
      return { status: 'UNCERTAIN', confidenceDelta: -0.05, explanation: 'observation was unclear' };
    }

    const explicitNegative = /(\bno\b|\bnone\b|\bnot\b|\bwithout\b)/i.test(observedOutcome);
    if (explicitNegative) {
      const positiveObservation = observedOutcome.replace(/\b(no|none|not|without)\b/ig, '').trim();
      if (positiveObservation && (predictedOutcome.includes(positiveObservation) || positiveObservation.includes(predictedOutcome))) {
        return { status: 'REJECTED', confidenceDelta: -0.1, explanation: 'prediction was contradicted by a negative observation' };
      }
    }

    const confirmed = observedOutcome.includes(predictedOutcome) || predictedOutcome.includes(observedOutcome) || (observedOutcome.includes('detail') && predictedOutcome.includes('detail')) || (observedOutcome.includes('category') && predictedOutcome.includes('category'));
    if (confirmed) {
      return { status: 'CONFIRMED', confidenceDelta: 0.1, explanation: 'prediction matched observed outcome' };
    }

    const weakOverlap = predictedOutcome.split(/\s+/).some(token => observedOutcome.includes(token));
    if (weakOverlap) {
      return { status: 'UNCERTAIN', confidenceDelta: 0.0, explanation: 'partial overlap with observed outcome' };
    }

    return { status: 'REJECTED', confidenceDelta: -0.1, explanation: 'prediction did not match observed outcome' };
  }
}
