
export type Term = "Q1" | "Q2" | "Q3" | "Q4" | "S1" | "S2" | "FY";

// this is for the short info on classes obtained from the class list
export interface ClassInfo {
    token: string,
    name: string,
    course: string,
    term: Term,
    teacher: string,
    email: string,
    classroom: string,
    letterGrade: string,
    grade: number,
    absent: number,
    tardy: number,
    dismissed: number
}

// this is more specific class data, when you pull info on a specific class
export interface ClassData {
    attendance: Attendance,
    grades: Record<1 | 2 | 3 | 4, TermGrades>,
    teacher: string,
    email: string,
    room: string,
}

// attendance. this is part of ClassData
type AttendanceType = "absent" | "tardy" | "dismissed"
type AttendanceField = Record<0 | 1 | 2 | 3 | "total", number>
type Attendance = Record<AttendanceType, AttendanceField>

// also part of ClassData
type GradeType = "assessments" | "participation" | "practiceAndApplication"
type GradeField = Record<GradeType, number>
interface TermGrades {
    weights: GradeField,
    assessments: number | null,
    participation: number | null,
    practiceAndApplication: number | null,
    total: number // not null, instead it'll be zero
}

// assignment stuff
export interface Assignment {
    name: string,
    dateAssigned: Date,
    dateDue: Date,
    schedule: string,
    score: string | "Ungraded",
    points: number | "Ungraded",
    grade: number | "Ungraded",
    feedback: string
}

// schedule stuff
export type Day = "M" | "T" | "W" | "Th" | "F1" | "F2" 
// this is split into 2 types so that the Day type can be used as keys, then
// intersected with some other keys (from ScheduleData)
type ScheduleDays = { [key in Day]: Period[] }
type ScheduleData = {
    currentDay: Day | null,
    currentClass: Period | null,
}
export type Schedule = ScheduleData & ScheduleDays;

export interface Period {
    course: string,
    name: string,
    teacher: string,
    room: string,
    currentPeriod: boolean,
}