import React from 'react';
import PropTypes from 'prop-types';

import {
  nerdlet,
  AccountStorageQuery,
  AccountStorageMutation,
  NerdGraphQuery,
  Icon,
  Modal,
} from 'nr1';

import BoardAdmin from './board-admin';
import CellDetails from './cell-details';

export default class Board extends React.Component {
  static propTypes = {
    board: PropTypes.object,
    accountId: PropTypes.number,
    currentUser: PropTypes.object,
    timeRange: PropTypes.object,
    onClose: PropTypes.func,
  };

  constructor(props) {
    super(props);

    this.state = {
      rows: [],
      cols: [],
      cells: [],
      data: {},
      alerts: {},
      timeoutId: null,
      modalHidden: true,
      detailsForCell: null,
    };

    this.getBoard = this.getBoard.bind(this);
    this.openAdmin = this.openAdmin.bind(this);
    this.closeAdmin = this.closeAdmin.bind(this);

    this.persistData = this.persistData.bind(this);
    this.fetchAlertStatuses = this.fetchAlertStatuses.bind(this);
    this.parseAlertStatuses = this.parseAlertStatuses.bind(this);
    this.humanizeNumber = this.humanizeNumber.bind(this);
    this.getCellContent = this.getCellContent.bind(this);
    this.showCellDetails = this.showCellDetails.bind(this);

    // nerdlet.setUrlState({
    //   id: ((props || {}).board || {}).id
    // })
  }

  componentDidMount() {
    this.getBoard();
  }

  componentDidUpdate(prevProps) {
    const { timeRange } = this.props;
    const prevTimeRange = prevProps.timeRange;

    if (!timeRange || !prevTimeRange) return;
    if (
      Object.keys(timeRange).every(
        t =>
          prevTimeRange.hasOwnProperty(t) && timeRange[t] === prevTimeRange[t]
      )
    )
      return;

    const { timeoutId } = this.state;
    if (timeoutId) clearTimeout(timeoutId);
    this.getBoard();
  }

  componentWillUnmount() {
    const { timeoutId } = this.state;
    if (timeoutId) clearTimeout(timeoutId);
  }

  getBoard() {
    const { board, accountId } = this.props;

    if (!board || !('id' in board)) return;

    AccountStorageQuery.query({
      collection: 'neondb-' + board.id,
      accountId: accountId,
      documentId: 'data',
    }).then(res => {
      const data = (res || {}).data || {};
      this.setState(
        {
          cells: data && 'cells' in data ? data.cells : [],
          cols: data && 'cols' in data ? data.cols : [],
          rows: data && 'rows' in data ? data.rows : [],
        },
        this.fetchAlertStatuses(data.cells)
      );
    });
  }

  openAdmin(e) {
    e.preventDefault();
    this.setState({ modalHidden: false });
  }

  closeAdmin() {
    this.setState({
      modalHidden: true,
      detailsForCell: null,
    });
  }

  closeBoard(e) {
    e.preventDefault();
    const { onClose } = this.props;

    if (onClose) onClose();
  }

  fetchAlertStatuses(cells) {
    if (!cells) cells = this.state.cells;
    const { fetching } = this.state;
    if (fetching) return;
    const { board, accountId, timeRange } = this.props;

    const { policies, attributes, data } = cells.reduce(
      (a, c) => {
        if (c.policy) a.policies.push("'" + c.policy + "'");
        if (c.details) a.attributes.push(c.details.str);
        return a;
      },
      { policies: [], attributes: [] }
    );

    const timePeriod =
      'SINCE ' +
      (timeRange && timeRange.duration
        ? timeRange.duration / 1000 + ' SECONDS AGO'
        : timeRange.begin_time + ' UNTIL ' + timeRange.end_time);
    const alertsQuery = policies.length
      ? `alerts: nrql(query: "SELECT latest(current_state) AS 'AlertStatus', latest(incident_id) AS 'IncidentId' FROM ${
          board.event
        } WHERE policy_name IN (${policies.join(
          ','
        )}) FACET policy_name, condition_name ${timePeriod} LIMIT MAX") { results }`
      : '';
    const valuesQuery = attributes.length
      ? `values: nrql(query: "SELECT ${attributes.join(', ')} FROM ${
          board.event
        } ${timePeriod}") { results }`
      : '';

    const gql = `{
      actor {
        account(id: ${accountId}) {
          ${alertsQuery}
          ${valuesQuery}
        }
      }
    }`;

    this.setState({
      fetching: true,
    });

    NerdGraphQuery.query({ query: gql })
      .then(this.parseAlertStatuses)
      .catch(err => {
        this.setState({
          fetching: false,
        });
      })
      .finally(() => {
        const timeoutId = setTimeout(this.fetchAlertStatuses, 60000);
        this.setState({
          timeoutId: timeoutId,
        });
      });
  }

  parseAlertStatuses(res) {
    const results = (((res || {}).data || {}).actor || {}).account || {};
    const alertsResults = (results.alerts || {}).results;
    const valuesResults = ((results.values || {}).results || []).shift();

    const alerts = alertsResults
      ? alertsResults.reduce((a, c) => {
          if (c.AlertStatus === 'open')
            a[c.facet[0]] = c.facet[0] in a ? a[c.facet[0]] + 1 : 1;
          return a;
        }, {})
      : {};

    if (valuesResults && 'timestamp' in valuesResults)
      delete valuesResults.timestamp;

    const data = valuesResults
      ? Object.keys(valuesResults).reduce((a, c) => {
          a[c] = valuesResults[c];
          return a;
        }, {})
      : {};

    this.setState({
      data: data,
      alerts: alerts,
      fetching: false,
    });
  }

  persistData(rows, cols, cells) {
    const { board, accountId } = this.props;

    const data = { rows: rows, cols: cols, cells: cells };

    AccountStorageMutation.mutate({
      actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
      collection: 'neondb-' + board.id,
      accountId: accountId,
      documentId: 'data',
      document: data,
    }).then(() => {
      this.setState(data);
    });
  }

  humanizeNumber(value, style) {
    if (!value && value != 0) return '';
    value = Number(value);
    if (Number.isNaN(value)) return '';
    const formatter = new Intl.NumberFormat('en-US', {
      style: style || 'decimal',
      maximumFractionDigits: 2,
    });
    if (value < 1000) return formatter.format(value);
    let suffixes = ['', 'k', 'm', 'b', 't'];
    const thousands =
      0 === value ? value : Math.floor(Math.log(value) / Math.log(1000));
    return (
      formatter.format(
        parseFloat((value / Math.pow(1000, thousands)).toFixed(2))
      ) + suffixes[thousands]
    );
  }

  getCellContent(row, col) {
    const { cells, data, alerts } = this.state;

    const match = cells
      .filter(cell => cell.row === row && cell.col === col)
      .shift();

    if (!match) return <span className={'circle unknown'} />;

    if (match.policy) {
      return (
        <span
          className={'circle ' + (match.policy in alerts ? 'alert' : 'ok')}
        />
      );
    } else if (match.details) {
      const num = data[match.details.name];
      const status = { class: '' };
      if (num && (match.details.is && match.details.value)) {
        const { is, value } = match.details;
        const comparator = `${num} ${
          is === 'more' ? '>' : is === 'less' ? '<' : '=='
        } ${value}`;
        status.class = eval(comparator) ? 'alert' : 'ok';
      }
      return (
        <span className={'text ' + status.class}>
          {this.humanizeNumber(num)}
        </span>
      );
    }
  }

  showCellDetails(row, col) {
    const { cells, data, alerts } = this.state;

    const match = cells
      .filter(cell => cell.row === row && cell.col === col)
      .shift();

    if (match)
      this.setState({
        modalHidden: false,
        detailsForCell: match,
      });
  }

  render() {
    const { rows, cols, cells, modalHidden, detailsForCell } = this.state;
    const { board, accountId, currentUser } = this.props;

    return (
      <div>
        <div className="board-title">
          <h2>{board.name}</h2>
        </div>
        <table className="board-table">
          <thead>
            <tr>
              <th></th>
              {cols.map(c => (
                <th className="rotate" key={c}>
                  <div>
                    <span>{c}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r}>
                <th className="row-header">{r}</th>
                {cols.map(c => (
                  <td
                    onClick={() => this.showCellDetails(r, c)}
                    key={r + '-' + c}
                  >
                    {this.getCellContent(r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="control-bar">
          <a href="#" className="default" onClick={e => this.openAdmin(e)}>
            admin
          </a>
          &nbsp;|&nbsp;
          <a href="#" className="default" onClick={e => this.closeBoard(e)}>
            boards
          </a>
        </div>
        <Modal hidden={modalHidden} onClose={this.closeAdmin}>
          {!detailsForCell && (
            <BoardAdmin
              rows={rows}
              cols={cols}
              cells={cells}
              onSave={this.persistData}
            />
          )}
          {detailsForCell && (
            <CellDetails
              board={board}
              accountId={accountId}
              currentUser={currentUser}
              cell={detailsForCell}
            />
          )}
        </Modal>
      </div>
    );
  }
}
