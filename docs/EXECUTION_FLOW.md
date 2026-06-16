# CSI-Ultimate — Execution Flow (v9 Production Path)

## CLI Command → Handler Mapping

```
--help                → printHelp()                    [v9.mjs:248]
--version             → printVersion()                 [v9.mjs:249]
--probe <url>        → probeSearchMechanism()          [v9.mjs:252-263]
--test                → runAllTests({live:false})      [v9.mjs:266-269]
--test-live           → runAllTests({live:true})       [v9.mjs:266-267]
--list-profiles       → listProfiles()                 [v9.mjs:272-275]
--status              → scheduler.listJobs()           [v9.mjs:278-282]
--schedule <interval> → scheduler.addJob()             [v9.mjs:310-323]
--categories          → runCategories()                [v9.mjs:346-348]
--search <keywords>   → runSearch()                    [v9.mjs:350-355]
(no flags)            → getLinksFromUrl(homepage)       [v9.mjs:360-361]
--save-profile <name> → saveProfile()                  [v9.mjs:295-305]
--interactive         → promptInteractive()            [v9.mjs:243-245]
```

## v9 Production Execution Path (evidence-classified)

```
main()                                                          RUNTIME_VERIFIED
  ├── parseCliArgs()                        [v9.mjs:240]       RUNTIME_VERIFIED
  ├── buildConfig()                          [v9.mjs:292]      RUNTIME_VERIFIED
  ├── createPool()                           [v9.mjs:340]      RUNTIME_VERIFIED
  │
  ├── DISCOVERY PHASE:
  │   ├── [--categories]                                        RUNTIME_VERIFIED (category-session.json)
  │   │   └── runCategories()
  │   │         ├── buildCategoryTree()       [category-walker.mjs:41]   RUNTIME_VERIFIED
  │   │         └── walkCategories()          [category-walker.mjs:224]  RUNTIME_VERIFIED
  │   │               └── getLinksFromUrl() per category
  │   │
  │   ├── [--search]                                               NO RUNTIME EVIDENCE
  │   │   └── runSearch()
  │   │         ├── [--post] → postSearchMultiple()  [post-search.mjs:326]  STATIC_ANALYSIS
  │   │         └── [default] → searchMultiple()      [keyword-search.mjs:136]  STATIC_ANALYSIS
  │   │
  │   └── [no flags]                                             RUNTIME_VERIFIED
  │       └── getLinksFromUrl(homepage)      [v9.mjs:360]
  │
  ├── getLinksFromUrl() DETAIL:              [v9.mjs:178-206]
  │   ├── smartLoad()                        [crawler-core.mjs:215]   RUNTIME_VERIFIED
  │   ├── classifyPageState()                [crawler-core.mjs:593]   RUNTIME_VERIFIED
  │   ├── discoverLinksFromHtml()            [crawler-core.mjs:521]   RUNTIME_VERIFIED
  │   ├── selectCandidateLinks()             [crawler-core.mjs:549]   RUNTIME_VERIFIED
  │   ├── learnLinkPatterns()                [crawler-core.mjs:530]   RUNTIME_VERIFIED
  │   ├── classifyPageSemantically() ⚡     [crawler-core.mjs:278]    STATIC_ANALYSIS ⚠ (wired here;
  │   │     └── semanticPageClassifier.classifyPage()                     RUNTIME_VERIFIED via extractAd path)
  │   ├── decidePageAction() ⚡             [crawler-core.mjs:301]    STATIC_ANALYSIS ⚠ (wired but
  │   │     ├── pageDecisionEngine.decide()                            NOT runtime-verified; all
  │   │     ├── opportunityScorer.score()                              10 intelligence-layer business
  │   │     ├── patternRegistry.findSimilarPatterns()                  methods below are STATIC_ANALYSIS)
  │   │     ├── discoveryHypothesisEngine.generateHypotheses()
  │   │     ├── explorationStrategy.rankActions()
  │   │     ├── patternRegistry.learnPattern()
  │   │     ├── crossSiteReasoner.reason()
  │   │     ├── universalKnowledgeEngine.abstractPageToConcept()
  │   │     ├── universalKnowledgeEngine.learnFromObservation()
  │   │     └── hypothesisValidator.validate()
  │   └── captureDiscoveryEvidence()         [crawler-core.mjs:124]  RUNTIME_VERIFIED
  │
  ├── SCRAPE PHASE:
  │   └── scrapeLinks()                      [v9.mjs:87-138]       RUNTIME_VERIFIED
  │         └── WorkerQueue.pushAll()
  │               └── per URL:
  │                     ├── throttle.waitFor()                     RUNTIME_VERIFIED
  │                     ├── retryHandler.run()                     RUNTIME_VERIFIED
  │                     │     └── extractAd()       [crawler-core.mjs:643]  RUNTIME_VERIFIED
  │                     │           ├── smartLoad()                RUNTIME_VERIFIED
  │                     │           ├── classifyPageSemantically() RUNTIME_VERIFIED (this path)
  │                     │           └── extractAdContentFromHtml() RUNTIME_VERIFIED
  │                     └── reporter.inc/recordError()             RUNTIME_VERIFIED
  │
  ├── EXPORT PHASE:
  │   └── exportAll()                        [exporter.mjs:155]    RUNTIME_VERIFIED
  │         ├── exportExcel()                [exporter.mjs:54]     RUNTIME_VERIFIED
  │         ├── exportJSON()                 [exporter.mjs:97]     RUNTIME_VERIFIED
  │         └── exportCSV()                  [exporter.mjs:121]    RUNTIME_VERIFIED
  │
  └── REPORT PHASE:
        ├── reporter.end()                                         RUNTIME_VERIFIED
        ├── reporter.printSummary()                                RUNTIME_VERIFIED
        └── reporter.saveReport()                                  RUNTIME_VERIFIED
```

## Decision Path Activation (post-audit — WIRED, NOT runtime-verified)

The intelligence layer was previously instantiated but never called.
After the fix, `decidePageAction()` is **wired** into `getLinksFromUrl()` at `v9.mjs:194-195`.
This means the following business methods are **code-reachable** but have **NO runtime trace evidence**:

| Module | Business Method | Evidence | Status |
|--------|----------------|----------|--------|
| PageDecisionEngine | decide() | STATIC_ANALYSIS — code wired; constructor runs | **PARTIALLY VERIFIED** |
| PatternRegistry | findSimilarPatterns(), learnPattern() | STATIC_ANALYSIS — only called via decidePageAction | **PARTIALLY VERIFIED** |
| PatternSimilarity | computeSimilarity() | STATIC_ANALYSIS — sub-dep of PatternRegistry | **PARTIALLY VERIFIED** |
| DiscoveryHypothesisEngine | generateHypotheses() | STATIC_ANALYSIS — only called via decidePageAction | **PARTIALLY VERIFIED** |
| ExplorationStrategy | rankActions() | STATIC_ANALYSIS — only called via decidePageAction | **PARTIALLY VERIFIED** |
| HypothesisValidator | validate() | STATIC_ANALYSIS — only called via decidePageAction | **PARTIALLY VERIFIED** |
| AdaptiveLearningLoop | getStats(), recordOutcome() | STATIC_ANALYSIS — adaptive-memory.json all zeros | **PARTIALLY VERIFIED** |
| OpportunityScorer | score() | STATIC_ANALYSIS — only called via decidePageAction | **PARTIALLY VERIFIED** |
| UniversalKnowledgeEngine | abstractPageToConcept(), learnFromObservation() | STATIC_ANALYSIS — only called via decidePageAction | **PARTIALLY VERIFIED** |
| KnowledgeTransferEngine | transferKnowledge() | STATIC_ANALYSIS — sub-dep of CrossSiteReasoner | **PARTIALLY VERIFIED** |
| CrossSiteReasoner | reason() | STATIC_ANALYSIS — only called via decidePageAction | **PARTIALLY VERIFIED** |
| ConceptAbstractionEngine | abstractConcepts() | STATIC_ANALYSIS — sub-dep of UniversalKnowledgeEngine | **PARTIALLY VERIFIED** |
| StructuralKnowledgeGraph | storeRelation(), queryRelations() | STATIC_ANALYSIS — sub-dep of UniversalKnowledgeEngine | **PARTIALLY VERIFIED** |

**Key insight**: `adaptive-memory.json` contains all zeros (successfulHypotheses: 0, failedHypotheses: 0, totalExplorations: 0).
This is definitive RUNTIME evidence that `recordOutcome()` was NEVER called, even though `AdaptiveLearningLoop` was instantiated (the file was loaded and saved by the constructor on every import).

**Verdict**: The intelligence layer is **wired for activation but not yet activated**. A full crawl run with the post-audit code is required to produce runtime trace evidence.
