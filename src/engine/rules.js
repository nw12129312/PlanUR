// Registry of every rule the engine can flag. Each violation carries a ruleId
// pointing here, so the UI (and tests) can always show *which* policy a
// violation came from and where that policy is documented.

export const RULES = {
  PREREQ_ORDER: {
    title: 'Prerequisite ordering',
    text: 'A course cannot be scheduled before (or in the same semester as) its prerequisites.',
  },
  PREREQ_UNVERIFIED: {
    title: 'Unverified prerequisite',
    text: 'This prerequisite was inferred from official sequence descriptions but not stated verbatim on a fetched page. Verify with the department.',
  },
  OFFERING_TERM: {
    title: 'Offering term',
    text: 'The course was not scheduled in this term in the 2025-26 CDCS schedules. Offering patterns can change year to year.',
  },
  OFFERING_UNVERIFIED: {
    title: 'Offering unverified',
    text: 'No schedule data was sourced for this course, so term placement cannot be checked.',
  },
  LOAD_MIN: {
    title: 'Under full-time load',
    text: 'Fewer than 12 credit hours in a fall/spring semester is below full-time status.',
  },
  LOAD_MAX: {
    title: 'Credit overload',
    text: 'More than 18 credit hours in a semester requires College approval.',
  },
  DUPLICATE_COURSE: {
    title: 'Duplicate course',
    text: 'The same course appears more than once in the plan.',
  },
  EQUIV_CONFLICT: {
    title: 'Equivalent-path conflict',
    text: 'These courses are alternative paths to the same requirement ("A instead of B"), not stackable courses — a plan may follow only one path per equivalency group.',
  },
  OVERLAP_MAJOR_MAJOR: {
    title: 'Double-major overlap cap',
    text: 'Two majors may share at most 3 courses (some majors restrict this to 2). Exempt foundational courses do not count.',
  },
  OVERLAP_MAJOR_MINOR: {
    title: 'Major/minor overlap cap',
    text: 'A major and a minor may share at most 2 courses. Exempt foundational courses do not count.',
  },
  OVERLAP_MINOR_MINOR: {
    title: 'Minor/minor overlap cap',
    text: 'Two minors may share at most 2 courses. Exempt foundational courses do not count.',
  },
  OVERLAP_CLUSTER_PROGRAM: {
    title: 'Cluster/program overlap cap',
    text: 'A cluster may share at most 1 course with any major or minor.',
  },
  CLUSTER_UNIQUE_TWO: {
    title: 'Cluster uniqueness',
    text: 'At least 2 of the 3 courses in a cluster must be unique - not used toward any major, minor, or other cluster.',
  },
  CLUSTER_DIVISION: {
    title: 'Cluster division',
    text: "Each cluster must be in a division other than the major's (engineering majors: humanities or social sciences).",
  },
  CLUSTER_DIVISION_DISTINCT: {
    title: 'Distinct cluster divisions',
    text: 'When two clusters are required, they must cover the two divisions outside the major - not the same division twice.',
  },
  CLUSTER_OWN_DEPT: {
    title: "Own department's cluster",
    text: "A student may not use a cluster from their own major's department.",
  },
  CLUSTER_SHARED_DEPT: {
    title: 'Clusters sharing a department',
    text: 'Two clusters that share the same home department may not both be used, even across divisions.',
  },
  CLUSTER_COURSE_REUSE: {
    title: 'Course in two clusters',
    text: 'No course may be used to satisfy two different clusters.',
  },
  CLUSTER_WRTG: {
    title: 'WRTG 105 in a cluster',
    text: 'WRTG 105 (and variants 105A/105B/105E) can never count toward a cluster.',
  },
  CLUSTER_APIB: {
    title: 'AP/IB credit in a cluster',
    text: 'AP/IB credit can never satisfy a cluster requirement.',
  },
  CLUSTER_TRANSFER: {
    title: 'Transfer credit in a cluster',
    text: 'Transfer credit generally cannot satisfy cluster requirements (study-abroad exceptions require department approval).',
  },
  DEPT_20_CAP: {
    title: 'Department course cap',
    text: 'No more than 20 courses from a single department may count toward the degree.',
  },
  TOTAL_CREDITS: {
    title: 'Total credit hours',
    text: 'The standard degree requires 128 credit hours; double-degree programs require 136; some Hajim majors require more.',
  },
  PWR_REQUIRED: {
    title: 'Primary Writing Requirement',
    text: 'Complete WRTG 105, WRTG 105E, or both WRTG 105A and 105B with a grade of C or better.',
  },
  PWR_TRANSFER: {
    title: 'PWR via transfer credit',
    text: 'WRTG 105 placed in the AP/IB/transfer bucket does not clearly satisfy the Primary Writing Requirement; confirm with the College.',
  },
  ULW_REQUIRED: {
    title: 'Upper-level writing',
    text: "Each major carries its own upper-level writing requirement, separate from WRTG 105.",
  },
  PROGRAM_NEEDS_DATA: {
    title: 'Requirements not loaded',
    text: 'Full requirements for this program have not been entered yet; progress cannot be computed. See the source link on the program card.',
  },
  CLUSTER_PARTIAL_PARSE: {
    title: 'Cluster partially parsed',
    text: 'This cluster uses a non-standard requirement format; the course list is present but the completion rule shown is approximate. Check the official listing.',
  },
  PROGRAM_TOTAL_COURSES: {
    title: 'Program course total',
    text: 'This program requires a minimum total number of courses.',
  },
  PROGRAM_MIN_DEPT: {
    title: 'Departmental designation minimum',
    text: 'This program requires a minimum number of its courses to carry specific department designations.',
  },
  PROGRAM_MAX_100: {
    title: '100-level cap',
    text: 'This program caps how many 100-level courses may count.',
  },
  DEPT_SEQUENCING: {
    title: 'Department course order',
    text: 'Within one department, courses are generally expected in ascending number order - a lower-numbered course should not sit in a later semester than a higher-numbered one. This convention is right most of the time but has exceptions: use "Allow" on the flagged pair to override it for this plan.',
  },
  DEPT_SEQ_UNPARSEABLE: {
    title: 'Code excluded from ordering check',
    text: 'This course code could not be parsed into department + number, so the department-ordering rule skips it.',
  },
  AP_IB_MAJOR_EXCLUDED: {
    title: 'AP/IB credit excluded from this major',
    text: 'This program grants only general credit for AP/IB exam scores - AP/IB-bucket courses can never satisfy its major or minor requirements.',
  },
  HOME_INSTITUTION_MIN: {
    title: 'Transfer share of the major',
    text: 'UR courses must fulfill at least half of the requirements in this concentration (ancillary-field courses are exempt from this restriction).',
  },
  UNVERIFIED_COURSE_DATA: {
    title: 'Unverified course data',
    text: 'Credits/offering data for this course was not found in the sourced schedules; defaults are assumed and flagged.',
  },
};

export function ruleInfo(ruleId) {
  return RULES[ruleId] || { title: ruleId, text: '' };
}
