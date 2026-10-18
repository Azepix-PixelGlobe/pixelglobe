import { numberToString, numberToStringFull } from '../core/utils.js';

const Stat = ({
  text, value, rank, zero, unit, full,
}) => (
  <p>
    <span className="stattext">{(rank) ? `${text}: #` : `${text}: `}</span>
  &nbsp;
    <span className="statvalue">{
      (full) ? numberToStringFull(value, zero) : numberToString(value, zero)
    } {unit}</span>
  </p>
);

export default Stat;
