// general stuff
export type Term = "Q1" | "Q2" | "Q3" | "Q4" | "S1" | "S2" | "FY";

// this is for the short info on classes obtained from the class list
// (from getClasses)
export interface ClassInfo {
	token: string; // the 'token' for the class, used as an ID to get more data about it
	name: string; // the name of the class
	course: string; // the course code
	term: Term; // what quarter / semester(s) it takes up
	teacher: string; // the teacher's name
	email: string; // the email of the teacher
	classroom: string; // the room number (if provided)
	letterGrade: string; // the student's letter grade in the class (A, B, C, etc)
	grade: number; // the student's grade from 1-100
	absent: number; // student's absences from that class
	tardy: number; // student's tardies in that class
	dismissed: number; // student's dismissed absences / tardies in that class
}

// this is more specific class data, when you pull info on a specific class
// (from getClass)
/* example:
{
  attendance: {
	absent: {
		1: ... // number of absences in quarter 1
		2: ...
		3: ...
		4: ...
	}
    tardy: { ... },
    dismissed: { '... }
  },
  grades: {
    '1': {
      weights: { // weights for each of the grade categories
		assessments: 50,
		participation: 30,
		practiceAndApplication: 20
	  },
      assessments: 100, // grade for assessments
      participation: 100,
      practiceAndApplication: 100,
      total: 100
    },
    2: { ... },
    3: { ... },
    4: { ... },
  },
  teacher: 'Last, First',
  email: 'foo@bar.com',
  room: 'A123'
}
*/
export interface ClassData {
	attendance: Attendance; // data about the student's attendance
	grades: Record<1 | 2 | 3 | 4, TermGrades>; // grades for each term
	teacher: string; // teacher's name
	email: string; // teacher's email
	room: string; // room number
}

// attendance. this is part of ClassData
type AttendanceType = "absent" | "tardy" | "dismissed";
type AttendanceField = Record<0 | 1 | 2 | 3 | "total", number>;
type Attendance = Record<AttendanceType, AttendanceField>;

// also part of ClassData
type GradeType = "assessments" | "participation" | "practiceAndApplication";
type GradeField = Record<GradeType, number>;
interface TermGrades {
	weights: GradeField;
	assessments: number | null;
	participation: number | null;
	practiceAndApplication: number | null;
	total: number; // not null, instead it'll be zero
}

// assignment stuff
export interface Assignment {
	name: string;
	dateAssigned: Date;
	dateDue: Date;
	// schedule: days you have that class. This isn't super relevant,
	// but otherwise I'd just be throwing away data
	// ex: "M,W,F1" (see `Day` type below)
	schedule: string;
	score: string | "Ungraded"; // string score, like: "9.0 / 10.0"
	points: number | "Ungraded"; // points gained (first number in that string score)
	grade: number | "Ungraded"; // grade out of 100
	feedback: string; // any teacher feedback
}

// schedule stuff
export type Day = "M" | "T" | "W" | "Th" | "F1" | "F2";
// this is split into 2 types so that the Day type can be used as keys, then
// intersected with some other keys (from ScheduleData)
type ScheduleDays = { [key in Day]: Period[] };
type ScheduleData = {
	currentDay: Day | null;
	currentClass: Period | null;
};
export type Schedule = ScheduleData & ScheduleDays;

export interface Period {
	course: string; // course code
	name: string; // course name
	teacher: string; // teacher name (Last, First)
	room: string; // room number
	currentPeriod: boolean; // if it's the current period or not
}

export enum AspenApiError {
	ConnectionError = "Unable to connect to Aspen",
	Generic500Error = "Aspen returned 500 Internal Server Error",
	InvalidLoginError = "Invalid Aspen username or password",
	InvalidSessionError = "Invalid Aspen Session",
	UnknownClassError = "Invalid Class Code",
}