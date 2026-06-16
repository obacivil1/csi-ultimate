# SemanticPageClassifier

Use this module to classify a page from its visible semantics rather than its URL or domain.

Example:

```js
import { SemanticPageClassifier } from './core/semantic-page-classifier.mjs';

const classifier = new SemanticPageClassifier();
const result = classifier.classifyPage('<html>...html...</html>');
console.log(result);
```

The classifier reads from config/semantic-classifier/dictionaries.json and supports the following page types:
- JOB_LISTING_PAGE
- JOB_AD_PAGE
- REAL_ESTATE_LISTING_PAGE
- REAL_ESTATE_AD_PAGE
- VEHICLE_LISTING_PAGE
- VEHICLE_AD_PAGE
- DIRECTORY_PAGE
- CATEGORY_PAGE
- BLOG_ARTICLE_PAGE
- UNKNOWN_PAGE
