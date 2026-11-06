# Clean Code, Appendix B: org.jfree.date.SerialDate (book pp. 349-407)

Almost pure code. The only prose is the license header, a change log, and Javadoc. Notes below are from the code itself, not from Chapter 16.

## 1. Listings

BEFORE (original JCommon code):
- B-1 SerialDate.java: the abstract base class, ~1,000 numbered lines (about 16 pages). It contains constants, static helpers and abstract methods. It has a 60-line license header and a hand-kept changelog from 2001-2005.
- B-2 SerialDateTest.java: the original JUnit tests, ~320 lines. About 20 tests. Many are weak (they assert only the day of month), and several are marked locale-dependent.
- B-3 MonthConstants.java: an interface of JANUARY=1 .. DECEMBER=12, ~90 lines, mostly one-line Javadocs.
- B-4 BobsSerialDateTest.java: the tests Martin wrote, ~457 lines. They are far more thorough. Some assertions are commented out and marked "todo". Those mark the behaviours that do not work yet, or that he chose not to support (case-insensitive parsing, 0 and 13 as months, invalid week or relative codes throwing).
- B-5 SpreadsheetDate.java: the concrete subclass, ~495 lines. It stores serial, day, month, year and description.
- B-6 RelativeDayOfWeekRule.java: ~209 lines of mostly getter and setter Javadoc. It uses the old int constants (PRECEDING, NEAREST, FOLLOWING). The appendix includes it as a client of SerialDate, but it is not refactored here.

AFTER (refactored):
- B-7 DayDate.java (Final): ~179 lines with the license header elided ("..."). It replaces SerialDate.
- B-8 Month.java (enum).
- B-9 Day.java (enum).
- B-10 DateInterval.java (enum).
- B-11 WeekInMonth.java (enum).
- B-12 WeekdayRange.java (enum, 3 lines).
- B-13 DateUtil.java.
- B-14 DayDateFactory.java.
- B-15 SpreadsheetDateFactory.java.
- B-16 SpreadsheetDate.java (Final): ~215 lines. It is the one "Final" class that replaces an original file.

Not shown: the final test class. There is no "after" version of BobsSerialDateTest. A "(Final)" marker appears only on B-7 through B-16.

## 2. Observable differences, original to refactored

Size and structure:
- SerialDate (~1,000 lines, most of them Javadoc and blank) became DayDate (~140 lines of code, no Javadoc on methods). The base class now holds only the instance behaviour.
- All the static helpers were removed from the base class. Calendar math moved to a new DateUtil: isLeapYear, leapYearCount, lastDayOfMonth, getMonthNames. Creation moved to DayDateFactory.
- Static methods taking a base date (addDays, addMonths, addYears, getPreviousDayOfWeek...) became instance methods (plusDays, plusMonths, plusYears, getPreviousDayOfWeek(Day)). The base-date parameter is gone.
- The duplicated pairs (a static version plus an instance version that delegates with "this") collapsed into one.
- The static factory methods createInstance(...) on the abstract class became DayDateFactory.makeDate(...). The abstract class no longer knows about its concrete subclass (SpreadsheetDate). The factory is swappable through setInstance.
- The factory's abstract hooks are prefixed with an underscore (_makeDate, _getMinimumYear).

Enums replacing int constants:
- MonthConstants (an interface of ints) became the Month enum. The int-valued weekday constants (MONDAY..SUNDAY, taken from Calendar) became the Day enum.
- INCLUDE_NONE/FIRST/SECOND/BOTH became DateInterval with OPEN, CLOSED_LEFT, CLOSED_RIGHT and CLOSED. Each constant overrides isIn(), so the if/else chain in isInRange disappeared.
- FIRST_WEEK_IN_MONTH.. LAST_WEEK_IN_MONTH became WeekInMonth.
- PRECEDING/NEAREST/FOLLOWING became WeekdayRange (LAST, NEAREST, NEXT).
- Behaviour moved into the enums:
  - Month gained lastDay(), quarter(), parse(), fromInt(), toInt() and toShortString().
  - Day gained parse(), fromInt() and toInt().
- This removed the big switch-case helpers: isValidMonthCode, isValidWeekdayCode, monthCodeToQuarter, monthCodeToString, stringToMonthCode, stringToWeekdayCode, weekdayCodeToString, weekInMonthToString, relativeToString and isValidWeekInMonthCode.
- Validation by switch became "fromInt throws IllegalArgumentException".

Dead code and unused tables deleted:
- The tables AGGREGATE_DAYS_TO_END_OF_MONTH and LEAP_YEAR_AGGREGATE_DAYS_TO_END_OF_MONTH are gone.
- Also gone: the LAST_DAY_OF_MONTH table on SerialDate (it moved into Month as a private table), DATE_FORMAT_SYMBOLS, SERIAL_LOWER_BOUND and SERIAL_UPPER_BOUND, and the public getMonths(boolean) variants.
- getDescription and setDescription were dropped from the base class and from SpreadsheetDate, together with the description field. The "this.description = null" assignment is gone too.
- The abstract compare() was replaced by daysSince(). The abstract isInRange variants were replaced by concrete implementations in the base class.
- The duplicate Javadoc copy-paste (for example, the "isOnOrBefore / isAfter / isOnOrAfter" docs all saying "same date as") disappeared with the Javadoc.

Naming:
- Serial was renamed to Ordinal (toSerial became getOrdinalDay). The reason is that the number is an ordinal from a fixed origin, not a "serial". Related renames: SERIAL_LOWER_BOUND to EARLIEST_DATE_ORDINAL, SERIAL_UPPER_BOUND to LATEST_DATE_ORDINAL, getYYYY to getYear, getEndOfCurrentMonth to getEndOfMonth.
- addDays/addMonths/addYears became plusDays/plusMonths/plusYears.
- Class SerialDate became DayDate.
- Misleading names were replaced by intent-revealing ones:
  - leap4/leap100/leap400 stayed.
  - calcSerial became calcOrdinal.
  - The cryptic locals yy/mm/dd and ss1/ss2/sss were replaced by names like daysUpToYear, daysUpToMonth, daysInMonth, firstOrdinalOfYear, overestimatedYear and underestimatedYear.
- getDayOfWeek in SpreadsheetDate used a magic formula, (serial+6)%7+1. It is now generic in DayDate: a getDayOfWeekForOrdinalZero() hook returns Day.SATURDAY, and the arithmetic uses named values (startingDay, startingOffset, ordinalOfDayOfWeek).
- Method names that said what they did: huntForYearContaining, huntForMonthContaining and daysBeforeThisMonth were extracted from the one long calcDayMonthYear. The extracted names are meant to read as a story.

Methods split or simplified:
- calcDayMonthYear was one long method with a loop. It was split into three small hunters plus helpers. The explanatory comments ("overestimated because we ignored leap days", "what's left is d(+1)") were mostly replaced by variable names, although a few such comments survive in the final code.
- isLeapYear was an if/else-if chain returning booleans. It became one expression with three named booleans: fourth, hundredth, fourHundredth.
- lastDayOfMonth went from 3 branches to a single if-else.
- plusMonths went from the dense (12*y + m + months - 1)/12 and %12+1 duplicated to named steps: thisMonthAsOrdinal, resultMonthAndYearAsOrdinal, resultYear, resultMonth. The "clamp the day to the end of the month" logic was extracted into correctLastDayOfMonth(), now shared by plusMonths and plusYears.
- getPreviousDayOfWeek and getFollowingDayOfWeek went from the min/max trick, with a duplicated validity check, to a short "offsetToTarget" with one adjustment of 7 days. The validity check itself disappeared because Day is an enum.
- getNearestDayOfWeek went from the two adjusted "adjust" tests (>= 4, <= -4) to offsetToFutureTarget/offsetToPreviousTarget and a single comparison against 3. Note: the original had a bug in it, and the BobsSerialDateTest "todo" cases (MONDAY, TUESDAY, THURSDAY etc. nearest) exercise that.
- toString went from concatenation to String.format("%02d-%s-%d").
- The constructors in SpreadsheetDate dropped the nested if/else that assigned fields inside the checks. Validation is now guard clauses that throw first, then assign.
- The year-range error message is built from the MINIMUM/MAXIMUM constants instead of the literal "1900 to 9999". One message still contains the literal "2 to 2958465", so it was not completely cleaned.

Comments:
- Removed: the license header (elided with "..." in the book listing), the changelog (Changes (from 11-Oct-2001) ...), most Javadoc on methods and fields, "Need to find a better approach" notes, "// check arguments..." and "// find the date..." comment lines, "// suppress", and the redundant param/return text.
- Rewritten: the class comment is shorter and states the invariant (immutable, precision of one day). The Javadoc "Requirement 1 / Requirement 2" list was dropped.
- Added: "@author Robert C. Martin did a lot of refactoring."; short end-of-line comments on EARLIEST_DATE_ORDINAL/LATEST_DATE_ORDINAL (1/1/1900, 12/31/9999). The Excel-bug explanation was kept in SpreadsheetDate because it records real intent.
- Not completely cleaned: the Javadoc of SpreadsheetDate was switched to <p/> and otherwise left alone.

Tests:
- B-2 is the original, weak test suite (about 20 tests, partly locale-dependent, serialization and bug-report tests, few boundary cases, assertions on only day-of-month).
- B-4 is Martin's coverage-driven suite: exhaustive loops, every month and weekday, boundary values (0, 13, 1900/1904/2100), invalid-input tests that expect exceptions, and a helper d(day, month, year) to keep assertions short.
- The "//todo" markers are tests that were commented out because they expose behaviour the code does not support yet (case-insensitive and out-of-range parsing, and exceptions for invalid week-in-month and relative codes).
- A createInstance test and a main() runner are included.
- No final version of the tests is listed in B-7..B-16.

Other structural changes:
- SpreadsheetDate lost its repeated conversions; there are now 2 int constructors plus one taking Month (the int, int, int one delegates).
- Dependency inversion: DayDate depends on the factory, not on SpreadsheetDate.
- Package-private static arrays were reduced to the two the subclass really needs (AGGREGATE_DAYS_TO_END_OF_PRECEDING_MONTH and the leap-year version).
- SpreadsheetDate.createInstance(Date) is a leftover static in the final code, duplicating SpreadsheetDateFactory._makeDate(Date).
- The final SpreadsheetDateFactory declares its _makeDate methods public although the base declares them protected.

## 3. Which of the book's heuristics are visible

Comments (C):
- C1 Inappropriate information (change history, author blocks, license boilerplate): the changelog and header disappear.
- C2 Obsolete comment, C3 Redundant comment, C5 Commented-out code: Javadoc that restates the signature is gone (the redundant docs of isOnOrBefore/isAfter/isOnOrAfter were also copy-pasted and wrong, an example of C2/C4 Poorly written comment).
- C5 Commented-out code: the "//todo"-marked tests in B-4 are commented-out tests. Martin leaves them as a to-do list, but a dead commented assertion is itself a smell.
- N/A for the rest.

Functions (F):
- F1 Too many arguments: the base-date argument is dropped by turning statics into instance methods.
- F4 Dead function: unused tables and helpers are deleted.

General (G):
- G5 Duplication: the instance and static twins collapse; correctLastDayOfMonth is shared; the validity checks are no longer repeated.
- G6 Code at wrong level of abstraction, and G7 Base classes depending on derivatives: SerialDate created SpreadsheetDate directly; the factory fixes that.
- G8 Too much information (a big public surface: many public constants and tables made private or deleted).
- G9 Dead code.
- G11 Inconsistency, G12 Clutter.
- G14 Feature envy, G15 Selector arguments.
- G16 Obscured intent: the formula (serial+6)%7+1 is now readable.
- G17 Misplaced responsibility: lastDay() and quarter() move into Month, and static calendar math moves to DateUtil.
- G18 Inappropriate static: static methods that take a SerialDate "base" parameter become instance methods.
- G19 Use explanatory variables: overestimatedYear, offsetToFutureTarget, etc.
- G20 Function names should say what they do: plusDays, huntForYearContaining.
- G22 Make logical dependencies physical.
- G23 Prefer polymorphism to if/else or switch/case: DateInterval constants override isIn(); the enum replaces the switch.
- G25 Replace magic numbers with named constants: EARLIEST_DATE_ORDINAL, MINIMUM_YEAR_SUPPORTED in messages. The checks against hard-coded 1900/9999/12 in validation are replaced.
- G28 Encapsulate conditionals: the three named booleans in isLeapYear.
- G30 Functions should do one thing, G34 One level of abstraction per function: calcDayMonthYear is split.
- G36 Avoid transitive navigation: partly.

Names (N):
- N1 Choose descriptive names, N3 Use standard nomenclature where possible, N4 Unambiguous names: serial versus ordinal.
- N5 Use long names for long scopes: the cryptic yy/mm/dd locals are replaced.
- N7 Names should describe side effects.

Java (J):
- J3 Constants versus enums: ints and interface constants are replaced by enums. J2 Don't inherit constants: the old SerialDate implemented MonthConstants only to get the constants.

Tests (T):
- T1 Insufficient tests, T2 Use a coverage tool, T3 Don't skip trivial tests, T4 An ignored test is a question about an ambiguity (the //todo cases), T5 Test boundary conditions, T6 Exhaustively test near bugs (getNearestDayOfWeek), T9 Tests should be fast.

Also demonstrated, from Chapter 16's story (not stated in the appendix itself): the Boy Scout rule and the refactoring approach. Martin built a coverage-driven test (B-4) before changing the code, then moved in small steps. Not every smell was removed (leftovers: the public _makeDate overrides, createInstance(Date), the literal "2 to 2958465", the legacy Comparable raw type).

## Coverage
Read lines 1-5672 (the whole file) in six chunks. Garbled or lossy parts:
- The PDF text extraction puts line numbers on their own lines. About half of the file is bare number lines, with the page footers and "Listing B-n (continued)" headers interleaved.
- In a few places the numbers and the code are separated or reordered: code lines appear after a block of numbers, and some closing braces ("}") were pushed onto number lines, for example lines 1886 and 2494.
- One character in a name is garbled in the changelog ("N???levka Petr").
- The license header of B-7 and B-16 is truncated by the book itself ("...").
- The final text on page 407 is followed by a blank page and the first words of Appendix C ("Appendix C"), which are not part of this slice.
